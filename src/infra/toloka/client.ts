import type { PersistentStore } from '../persistence/store.ts'
import type { TolokaResult, TolokaClientConfig } from './types.ts'
import { parseSearchPage, isLoginPage, isAuthenticated } from './parser.ts'

const COOKIE_KEY = 'toloka_cookie'

/** Index of an ASCII needle within a byte array, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: string): number {
  const n = needle.length
  outer: for (let i = 0; i + n <= haystack.length; i++) {
    for (let j = 0; j < n; j++) if (haystack[i + j] !== needle.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

/**
 * A valid `.torrent` is a bencoded dict (starts with `d`) that contains the BT
 * `pieces` key. The first-byte check alone is too weak: when Toloka rate-limits
 * a download it can return a SHORT/TRUNCATED body that still starts with `d` —
 * which `looksLikeTorrent` used to accept, and DSM then created a task with no
 * metadata (size 0, no files/trackers, stuck «ОЖИДАНИЕ»). Requiring `6:pieces`
 * rejects those so the caller re-logins/retries or surfaces a clear error.
 */
function looksLikeTorrent(bytes: Uint8Array): boolean {
  let i = 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  if (bytes[i] !== 0x64) return false
  return indexOfBytes(bytes, '6:pieces') >= 0
}

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
  /** Short-lived cache of fetched .torrent bytes by download URL (see downloadTorrent). */
  private torrentCache = new Map<string, { bytes: Uint8Array; at: number }>()

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
    // The add-flow downloads the SAME .torrent twice within seconds — once for
    // the file-preview inspect (#123) and again for the actual add — and Toloka
    // rate-limits the second hit, returning truncated junk that produced an
    // empty DownloadStation task. Serve a recently-fetched .torrent from a
    // short-lived cache so each add costs Toloka a single download.
    const TTL_MS = 3 * 60 * 1000
    const cached = this.torrentCache.get(downloadUrl)
    if (cached && Date.now() - cached.at < TTL_MS) {
      return cached.bytes
    }

    let bytes = await this.fetchTorrentBytes(downloadUrl)

    // A stale session makes download.php return an HTML login page (HTTP 200),
    // NOT a .torrent — `res.ok` passes and DSM is fed garbage bytes, which fails
    // both the #123 file-list inspect ("couldn't read file list") and the create
    // (the HTTP 502 the owner hit). The search path re-logins on a stale session;
    // download must too. A bencoded torrent starts with 'd'; if it doesn't,
    // re-login once and retry, then give up with a clear error rather than
    // returning a login page as a torrent.
    if (!looksLikeTorrent(bytes)) {
      await this.login()
      bytes = await this.fetchTorrentBytes(downloadUrl)
      if (!looksLikeTorrent(bytes)) {
        throw new Error('Toloka session expired: download returned a non-torrent response (login page?) even after re-login')
      }
    }

    this.torrentCache.set(downloadUrl, { bytes, at: Date.now() })
    return bytes
  }

  private async fetchTorrentBytes(downloadUrl: string): Promise<Uint8Array> {
    // redirect:'follow' so Toloka's download.php 3xx to the actual .torrent is
    // followed automatically. fetchWithAuth uses redirect:'manual' (needed for
    // login Set-Cookie capture + stale-session detection on search), so we issue
    // a dedicated fetch here. See fix for #92.
    // 30s timeout so a hung Toloka download surfaces as a clear error instead of
    // leaving the /api/tasks request to time out at the Cloudflare gateway (the
    // opaque "HTTP 502" the owner saw).
    let res: Response
    try {
      res = await fetch(downloadUrl, {
        headers: {
          Cookie: this.serializeCookies(),
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('Toloka download timed out after 30s')
      }
      throw err
    }

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
