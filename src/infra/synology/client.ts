import type { SynoEnvelope, SynoAuthData, SynologyConfig, ReachabilityResult, SystemUtilization, StorageInfo, DiskInfo } from './types.ts'

export class SynologyClient {
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

  async isReachable(): Promise<ReachabilityResult> {
    try {
      const result = await this.request<unknown>('SYNO.API.Info', 1, 'query', { query: 'all' })
      if (result.ok) return { ok: true }
      return result
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { ok: false, reason }
    }
  }

  async request<T>(
    api: string,
    version: number,
    method: string,
    params: Record<string, string | number> = {}
  ): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
    const url = this.buildUrl('webapi/query.cgi', {
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

      if (code === 119) {
        // Session expired — re-login once and retry
        await this.login()
        return this.requestOnce<T>(api, version, method, params)
      }

      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}` }
    }

    return { ok: true, data: json.data as T }
  }

  private async requestOnce<T>(
    api: string,
    version: number,
    method: string,
    params: Record<string, string | number> = {}
  ): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
    const url = this.buildUrl('webapi/query.cgi', {
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
      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}` }
    }

    return { ok: true, data: json.data as T }
  }

  async getSystemUtilization(): Promise<{ ok: true; data: SystemUtilization } | { ok: false; reason: string }> {
    return this.request<SystemUtilization>('SYNO.Core.System.Utilization', 1, 'get')
  }

  async getStorageInfo(): Promise<{ ok: true; data: StorageInfo } | { ok: false; reason: string }> {
    return this.request<StorageInfo>('SYNO.Core.Storage.Volume', 1, 'list')
  }

  async getDiskInfo(): Promise<{ ok: true; data: DiskInfo } | { ok: false; reason: string }> {
    return this.request<DiskInfo>('SYNO.Core.Storage.Disk', 1, 'list')
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.host}/${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    return url.toString()
  }
}
