import type { SynoEnvelope, SynoAuthData, SynologyConfig, ReachabilityResult, Task, SynoTaskListData, SystemUtilization, StorageInfo, DiskInfo, SharedFolder, FolderEntry } from './types.ts'

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

  async listTasks(): Promise<{ ok: true; data: Task[] } | { ok: false; reason: string }> {
    const result = await this.request<SynoTaskListData>(
      'SYNO.DownloadStation.Task',
      1,
      'list',
      { additional: 'detail,transfer' }
    )
    if (!result.ok) return result
    return { ok: true, data: result.data.tasks ?? [] }
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
        // Session expired -- re-login once and retry
        await this.login()
        return this.requestOnce<T>(api, version, method, params)
      }

      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}` }
    }

    return { ok: true, data: json.data as T }
  }

  async createDownloadTask(
    magnet: string,
    destination: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'create', {
      uri: magnet,
      destination,
    })
    if (!result.ok) return result
    return { ok: true }
  }

  async listSharedFolders(): Promise<{ ok: true; data: SharedFolder[] } | { ok: false; reason: string }> {
    const result = await this.request<{ shares: SharedFolder[] }>('SYNO.FileStation.List', 2, 'list_share', {})
    if (!result.ok) return result
    return { ok: true, data: result.data.shares ?? [] }
  }

  async listFolders(folderPath: string): Promise<{ ok: true; data: FolderEntry[] } | { ok: false; reason: string }> {
    const result = await this.request<{ files: FolderEntry[] }>('SYNO.FileStation.List', 2, 'list', {
      folder_path: folderPath,
      filetype: 'dir',
    })
    if (!result.ok) return result
    return { ok: true, data: result.data.files ?? [] }
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
