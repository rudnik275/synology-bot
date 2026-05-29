import type { PersistentStore } from '../persistence/store.ts'
import type { TolokaResult, TolokaClientConfig } from './types.ts'
import { parseSearchPage, isLoginPage, isAuthenticated } from './parser.ts'

const COOKIE_KEY = 'toloka_cookie'

/**
 * HTTP-only Toloka client. Uses fetch + cookie jar stored in PersistentStore.
 *
 * Why no browser automation: see docs/integrations/toloka-defences.md (probed 2026-05-24).
 * The only fallback we need is session-expired detection — if the server returns the
 * login page, re-login once and retry. Revisit if you observe cf-browser-verification
 * HTML, 403/503 with a valid cookie, or login-form changes.
 */
export class TolokaClient {
  private config: TolokaClientConfig
  private store: PersistentStore
  private cookies: Map<string, string>

  constructor(config: TolokaClientConfig, store: PersistentStore) {
    this.config = config
    this.store = store
    this.cookies = this.loadCookies()
  }

  isLoggedIn(): boolean {
    return this.cookies.size > 0
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(): Promise<void> {
    const { baseUrl, username, password } = this.config

    // Toloka's login.php form submits its `login` button field (value "Вхід")
    // plus a `redirect` hidden field — there is NO `entry` field. Sending the
    // wrong fields makes login.php return a guest session (HTTP 200, no real
    // auth), so every tracker.php search then yields zero results.
    const body = new URLSearchParams({
      username,
      password,
      autologin: 'on',
      ssl: 'on',
      redirect: '',
      login: 'Вхід',
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

    const res = await this.fetchWithAuth(url)
    const html = await res.text()

    // Stale/guest session → re-login once and retry. Toloka signals this in two
    // ways: the login form (isLoginPage), OR — on tracker.php — an empty page
    // with no login form AND no logout link (!isAuthenticated). The latter is
    // why a bad session silently returned zero results before.
    if (isLoginPage(html) || !isAuthenticated(html)) {
      await this.login()
      const retryRes = await this.fetchWithAuth(url)
      const retryHtml = await retryRes.text()

      if (isLoginPage(retryHtml) || !isAuthenticated(retryHtml)) {
        throw new Error('Toloka auth failed: still not authenticated after re-login')
      }

      return parseSearchPage(retryHtml, this.config.baseUrl)
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
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchWithAuth(url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Cookie: this.serializeCookies(),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'manual',
    })
  }

  private extractSetCookieHeaders(res: Response): string[] {
    // `Headers.forEach`/iteration COMBINES multiple Set-Cookie headers into one
    // comma-joined string (undici/Bun behavior). Splitting that by ';' keeps only
    // the first cookie and drops the session cookie (toloka_sid) — so the login
    // looked successful but every search ran as a guest. `getSetCookie()` returns
    // each Set-Cookie header separately, which is what we need.
    const all = res.headers.getSetCookie?.()
    if (all && all.length > 0) return all
    const single = res.headers.get('set-cookie')
    return single ? [single] : []
  }

  private parseCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
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
