import type { SynoEnvelope, SynoAuthData, SynologyConfig } from './types.ts'
import { ok, err, type Result } from '../../lib/result.ts'

export const PATH_ENTRY = 'webapi/entry.cgi'
export const PATH_DOWNLOAD_TASK = 'webapi/DownloadStation/task.cgi'
export const PATH_DOWNLOAD_INFO = 'webapi/DownloadStation/info.cgi'

/** Hard timeout for every DSM round-trip (login + business requests). */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * DSM error codes that mean "the session/SID is no longer valid" — all of them
 * warrant exactly one re-login + retry:
 *   105 — insufficient privilege (returned for stale/invalid SID too)
 *   106 — session timeout
 *   107 — session interrupted by duplicated login
 *   119 — SID not found
 */
const SESSION_EXPIRED_CODES = new Set([105, 106, 107, 119])

/**
 * The DSM HTTP transport: login, session (SID), the single `send()` round-trip,
 * and the re-login/retry policy. Every grouped API (DownloadTasksApi,
 * InspectListApi, SystemHealthApi, FileStationApi) shares one instance, so the
 * SID and retry behaviour are defined in exactly one place.
 */
export class SynoTransport {
  private host: string
  private user: string
  private password: string
  private sid: string | null = null
  /**
   * Single in-flight login promise (mutex): concurrent requests that hit
   * session expiry at the same time share ONE login round-trip instead of
   * stampeding the DSM auth endpoint. Cleared when the login settles.
   */
  private loginPromise: Promise<void> | null = null

  constructor(config: SynologyConfig) {
    this.host = config.host.replace(/\/$/, '')
    this.user = config.user
    this.password = config.password
  }

  /**
   * Logs in and stores the SID. Throws on failure (direct callers like app
   * startup want the loud failure); `request()` adapts that throw into a
   * `{ ok: false, reason }` Result. Concurrent callers share one in-flight
   * login round-trip.
   */
  login(): Promise<void> {
    if (!this.loginPromise) {
      this.loginPromise = this.doLogin().finally(() => {
        this.loginPromise = null
      })
    }
    return this.loginPromise
  }

  private async doLogin(): Promise<void> {
    const url = this.buildUrl('webapi/auth.cgi', {
      api: 'SYNO.API.Auth',
      version: '3',
      method: 'login',
      account: this.user,
      passwd: this.password,
      session: 'DownloadStation',
    })

    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const json: SynoEnvelope<SynoAuthData> = await res.json()

    if (!json.success || !json.data?.sid) {
      throw new Error(`Login failed: code ${json.error?.code ?? 'unknown'}`)
    }

    this.sid = json.data.sid
  }

  async request<T>(
    api: string,
    version: number,
    method: string,
    params: Record<string, string | number> = {},
    path: string = PATH_ENTRY,
  ): Promise<Result<T>> {
    const first = await this.send<T>(api, version, method, params, path)
    if (first.ok) return first

    // Session expired -- re-login once and retry exactly once. The retry goes
    // through send() directly (NOT request()), so a second failure surfaces as
    // { ok: false } instead of recursing into another re-login. A failed
    // re-login is also adapted to { ok: false } — request() never throws.
    if (first.code !== undefined && SESSION_EXPIRED_CODES.has(first.code)) {
      try {
        await this.login()
      } catch (e) {
        return err(`Re-login failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      return this.send<T>(api, version, method, params, path)
    }

    return { ok: false, reason: first.reason }
  }

  /**
   * One round-trip to the DSM API: buildUrl + fetch + parse + `json.success`.
   * Returns the parsed data on success, or a failure carrying the Synology
   * error `code` so the caller (`request`) can decide whether to re-login.
   * This is the single shared core that both the first attempt and the
   * post-re-login retry call — there is no duplicated fetch/parse block.
   */
  private async send<T>(
    api: string,
    version: number,
    method: string,
    params: Record<string, string | number> = {},
    path: string = PATH_ENTRY,
  ): Promise<Result<T> & { code?: number }> {
    const url = this.buildUrl(path, {
      api,
      version: String(version),
      method,
      _sid: this.sid ?? '',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    })

    let json: SynoEnvelope<T>
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      json = await res.json()
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        return err(`Synology request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      }
      return err(`Synology request failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!json.success) {
      const code = json.error?.code
      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}`, code }
    }

    return ok(json.data as T)
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.host}/${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    return url.toString()
  }
}
