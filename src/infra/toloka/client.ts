import type { PersistentStore } from '../persistence/store.ts'
import type { TolokaResult, TolokaClientConfig } from './types.ts'
import { parseSearchPage, isLoginPage } from './parser.ts'
import type { PlaywrightFallbackOptions, PlaywrightFallbackResult } from './playwright-fallback.ts'

const COOKIE_KEY = 'toloka.session.cookies'

/** Cloudflare / bot-detection markers that indicate a non-usable response. */
const INTERSTITIAL_MARKERS = [
  'cf-browser-verification',
  'Just a moment...',
  'checking your browser',
  'challenge',
  'ddos-guard',
]

/** HTTP status codes that trigger Playwright fallback. */
const FALLBACK_STATUS_CODES = new Set([403, 503])

/** Type for the injected fallback function (allows mocking in tests). */
type FallbackFn = (
  query: string,
  opts: PlaywrightFallbackOptions
) => Promise<PlaywrightFallbackResult>

/**
 * HTTP-first Toloka client. Uses fetch + cookie jar stored in PersistentStore.
 * Falls back to a Playwright-based path when HTTP hits bot-detection / Cloudflare.
 */
export class TolokaClient {
  private config: TolokaClientConfig
  private store: PersistentStore
  private cookies: Map<string, string>
  private playwrightFallback: FallbackFn

  constructor(
    config: TolokaClientConfig,
    store: PersistentStore,
    /**
     * Injected fallback function. In production, this dynamically imports
     * playwright-fallback.ts. In tests, pass a mock.
     */
    playwrightFallback?: FallbackFn
  ) {
    this.config = config
    this.store = store
    this.cookies = this.loadCookies()
    // Default: lazy dynamic import of the real Playwright fallback.
    this.playwrightFallback =
      playwrightFallback ??
      (async (query, opts) => {
        const { playwrightFallback: realFallback } = await import('./playwright-fallback.ts')
        return realFallback(query, opts)
      })
  }

  isLoggedIn(): boolean {
    return this.cookies.size > 0
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(): Promise<void> {
    const { baseUrl, username, password } = this.config

    const body = new URLSearchParams({
      entry: 'login',
      username,
      password,
      autologin: 'on',
      ssl: 'on',
    })

    const res = await fetch(`${baseUrl}/login.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      redirect: 'manual',
    })

    const setCookieHeaders = this.extractSetCookieHeaders(res)
    if (setCookieHeaders.length === 0) {
      // Even on redirect, Set-Cookie might be on the response
      const locationHeader = res.headers.get('location') ?? ''
      if (!locationHeader && setCookieHeaders.length === 0) {
        throw new Error('Toloka login failed: no Set-Cookie headers received')
      }
    }

    this.parseCookies(setCookieHeaders)
    this.persistCookies()
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query: string): Promise<TolokaResult[]> {
    const url = `${this.config.baseUrl}/tracker.php?nm=${encodeURIComponent(query)}`

    // --- HTTP attempt ---
    const res = await this.fetchWithAuth(url)
    const html = await res.text()

    // Handle login page: session expired → re-login and retry once.
    // This is NOT a fallback case — it's a credentials/session issue.
    if (isLoginPage(html)) {
      await this.login()
      const retryRes = await this.fetchWithAuth(url)
      const retryHtml = await retryRes.text()

      if (isLoginPage(retryHtml)) {
        throw new Error('Toloka auth failed: still showing login page after re-login')
      }

      // Check if the post-relogin response is also blocked
      const retryFallbackReason = this.detectFallbackReason(retryRes.status, retryHtml)
      if (retryFallbackReason) {
        return this.runPlaywrightFallback(query, retryFallbackReason)
      }

      return parseSearchPage(retryHtml, this.config.baseUrl)
    }

    // Check for bot-detection / Cloudflare interstitial
    const fallbackReason = this.detectFallbackReason(res.status, html)
    if (fallbackReason) {
      return this.runPlaywrightFallback(query, fallbackReason)
    }

    return parseSearchPage(html, this.config.baseUrl)
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  getDownloadUrl(topicId: string): string {
    return `${this.config.baseUrl}/download.php?id=${topicId}`
  }

  async downloadTorrent(downloadUrl: string): Promise<Uint8Array> {
    const res = await this.fetchWithAuth(downloadUrl)

    if (!res.ok) {
      throw new Error(`Failed to download torrent: HTTP ${res.status}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }

  // -------------------------------------------------------------------------
  // Playwright fallback
  // -------------------------------------------------------------------------

  /**
   * Determines if the HTTP response warrants a Playwright fallback.
   * Returns a human-readable reason string if fallback should trigger, or null otherwise.
   */
  private detectFallbackReason(status: number, html: string): string | null {
    if (FALLBACK_STATUS_CODES.has(status)) {
      return `HTTP ${status} status (bot-detection or service unavailable)`
    }

    for (const marker of INTERSTITIAL_MARKERS) {
      if (html.includes(marker)) {
        return `interstitial marker found: "${marker}"`
      }
    }

    return null
  }

  /**
   * Runs the Playwright fallback. Logs a warning, invokes the fallback,
   * persists any returned cookies, and returns parsed results.
   *
   * Throws when playwright is disabled or the fallback itself throws.
   */
  private async runPlaywrightFallback(query: string, reason: string): Promise<TolokaResult[]> {
    if (this.config.playwrightEnabled === false) {
      throw new Error(
        `Toloka HTTP blocked (${reason}) but Playwright fallback is disabled. ` +
        `Set TOLOKA_PLAYWRIGHT_ENABLED=true to enable bot-detection fallback.`
      )
    }

    console.warn(
      `[TolokaClient] Toloka HTTP failed (${reason}), using Playwright fallback for query: ${query}`
    )

    const { results, newCookie } = await this.playwrightFallback(query, {
      baseUrl: this.config.baseUrl,
      username: this.config.username,
      password: this.config.password,
      cookie: this.serializeCookies() || undefined,
      userAgent: this.config.userAgent,
    })

    // Persist refreshed cookies back to the session store
    if (newCookie) {
      this.updateCookiesFromString(newCookie)
      this.persistCookies()
    }

    return results
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchWithAuth(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Cookie: this.serializeCookies(),
      'User-Agent': this.config.userAgent ?? 'Mozilla/5.0 (compatible; nas-torrent-bot)',
    }
    return fetch(url, {
      headers,
      redirect: 'manual',
    })
  }

  private extractSetCookieHeaders(res: Response): string[] {
    // Headers.getAll is not standard; iterate all Set-Cookie values
    const cookieHeaders: string[] = []
    // Bun/Node.js: res.headers is Headers; iterate manually
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookieHeaders.push(value)
      }
    })
    return cookieHeaders
  }

  private parseCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      // Format: name=value; Path=/; HttpOnly; ...
      const parts = header.split(';')
      const nameValue = parts[0]?.trim()
      if (!nameValue) continue

      const eqIdx = nameValue.indexOf('=')
      if (eqIdx === -1) continue

      const name = nameValue.slice(0, eqIdx).trim()
      const value = nameValue.slice(eqIdx + 1).trim()

      if (name) {
        this.cookies.set(name, value)
      }
    }
  }

  /**
   * Updates internal cookie map from a serialized cookie string
   * (e.g. "PHPSESSID=abc; bb_session=xyz").
   */
  private updateCookiesFromString(cookieStr: string): void {
    cookieStr
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const eqIdx = part.indexOf('=')
        if (eqIdx === -1) return
        const name = part.slice(0, eqIdx).trim()
        const value = part.slice(eqIdx + 1).trim()
        if (name) this.cookies.set(name, value)
      })
  }

  private serializeCookies(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  private persistCookies(): void {
    const serialized = JSON.stringify(Object.fromEntries(this.cookies))
    this.store.setKv(COOKIE_KEY, serialized)
  }

  private loadCookies(): Map<string, string> {
    const stored = this.store.getKv(COOKIE_KEY)
    if (!stored) return new Map()

    try {
      const obj = JSON.parse(stored) as Record<string, string>
      return new Map(Object.entries(obj))
    } catch {
      return new Map()
    }
  }
}
