import type { SynoEnvelope, SynoAuthData, SynologyConfig } from './types.ts'
import { ok, type Result } from '../../lib/result.ts'

export const PATH_ENTRY = 'webapi/entry.cgi'
export const PATH_DOWNLOAD_TASK = 'webapi/DownloadStation/task.cgi'
export const PATH_DOWNLOAD_INFO = 'webapi/DownloadStation/info.cgi'

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

  constructor(config: SynologyConfig) {
    this.host = config.host.replace(/\/$/, '')
    this.user = config.user
    this.password = config.password
  }

  async login(): Promise<void> {
    const url = this.buildUrl('webapi/auth.cgi', {
      api: 'SYNO.API.Auth',
      version: '3',
      method: 'login',
      account: this.user,
      passwd: this.password,
      session: 'DownloadStation',
    })

    const res = await fetch(url)
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
    // { ok: false } instead of recursing into another re-login.
    if (first.code === 119) {
      await this.login()
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

    const res = await fetch(url)
    const json: SynoEnvelope<T> = await res.json()

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
