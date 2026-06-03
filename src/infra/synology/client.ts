import type { SynoEnvelope, SynoAuthData, SynologyConfig, ReachabilityResult, Task, SynoTaskListData, SystemUtilization, StorageInfo, DiskInfo, DiskEntry, SharedFolder, FolderEntry, SynoStorageLoadInfo, ProcessGroupList, ProcessGroupSlice } from './types.ts'

const PATH_ENTRY = 'webapi/entry.cgi'
const PATH_DOWNLOAD_TASK = 'webapi/DownloadStation/task.cgi'

/**
 * Converts a FileStation absolute path to a DownloadStation share-relative path.
 *
 * FileStation returns paths with a leading slash (e.g. `/video/Movies`), but
 * DownloadStation `create` expects a share-relative path without the leading
 * slash (e.g. `video/Movies`). This function also strips a `/volumeN/` prefix
 * if one is present.
 *
 * @example
 * normalizeDownloadDestination('/video/Movies') // 'video/Movies'
 * normalizeDownloadDestination('/volume1/video/Movies') // 'video/Movies'
 * normalizeDownloadDestination('video/Movies') // 'video/Movies' (idempotent)
 */
export function normalizeDownloadDestination(destination: string): string {
  // Strip /volumeN/ prefix (e.g. /volume1/, /volume2/)
  let normalized = destination.replace(/^\/volume\d+\//, '/')
  // Strip leading slash
  normalized = normalized.replace(/^\//, '')
  return normalized
}

/** Synology HDD temperature classification, synthesised from numeric `temp` (°C). */
function classifyTemp(t: number): 'normal' | 'warning' | 'critical' {
  if (t >= 56) return 'critical'
  if (t >= 50) return 'warning'
  return 'normal'
}

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
      { additional: 'detail,transfer' },
      PATH_DOWNLOAD_TASK,
    )
    if (!result.ok) return result
    return { ok: true, data: result.data.tasks ?? [] }
  }

  async pauseTask(taskId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'pause', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async resumeTask(taskId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'resume', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async deleteTask(taskId: string, deleteFiles = false): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'delete', {
      id: taskId,
      force_complete: 'false',
      delete_files: deleteFiles ? 'true' : 'false',
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async isReachable(): Promise<ReachabilityResult> {
    try {
      const result = await this.request<unknown>('SYNO.API.Info', 1, 'query', { query: 'all' }, 'webapi/query.cgi')
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
    params: Record<string, string | number> = {},
    path: string = PATH_ENTRY,
  ): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
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

      if (code === 119) {
        // Session expired -- re-login once and retry
        await this.login()
        return this.requestOnce<T>(api, version, method, params, path)
      }

      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}` }
    }

    return { ok: true, data: json.data as T }
  }

  /**
   * Add a Download Task from a `uri` — a magnet, or an HTTP(S) `.torrent` link
   * (including one served by our own Mini App server for held bytes). Uses
   * `SYNO.DownloadStation2.Task` `create` with `type:"url"` — the SAME call the
   * DSM web UI's "Create via URL" makes, and the ONLY one that actually parses a
   * `.torrent` URL and starts the download.
   *
   * ⚠️ Verified live on the NAS (2026-06-03): the documented
   * `SYNO.DownloadStation.Task` v3 `create` `uri` creates a task that sits at
   * "waiting" / size Unknown forever — DSM never parses the linked `.torrent`.
   * The SAME url added via DownloadStation2 `type:"url"` parses immediately
   * (e.g. a 27.5 GB torrent) and downloads. So we use DS2 here.
   *
   * DS2 `entry.cgi` wants JSON-encoded values: `type` as `"url"`, `url` as a
   * JSON array `["…"]`, `destination` as `"…"` (plain values are misread).
   * `create_list:false` adds the whole torrent (no per-file inspect list).
   */
  async createDownloadTask(
    uri: string,
    destination: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation2.Task', 2, 'create', {
      create_list: 'false',
      type: '"url"',
      url: JSON.stringify([uri]),
      destination: `"${normalizeDownloadDestination(destination)}"`,
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
    params: Record<string, string | number> = {},
    path: string = PATH_ENTRY,
  ): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
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
      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}` }
    }

    return { ok: true, data: json.data as T }
  }

  async getSystemUtilization(): Promise<{ ok: true; data: SystemUtilization } | { ok: false; reason: string }> {
    return this.request<SystemUtilization>('SYNO.Core.System.Utilization', 1, 'get')
  }

  async getStorageInfo(): Promise<{ ok: true; data: StorageInfo } | { ok: false; reason: string }> {
    const result = await this.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    return { ok: true, data: { volumes: result.data.volumes ?? [] } }
  }

  async getDiskInfo(): Promise<{ ok: true; data: DiskInfo } | { ok: false; reason: string }> {
    const result = await this.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    const disks: DiskEntry[] = (result.data.disks ?? []).map(d => ({
      ...d,
      temperature_status: classifyTemp(d.temp),
    }))
    return { ok: true, data: { disks } }
  }

  async getProcessGroups(): Promise<{ ok: true; data: ProcessGroupSlice[] } | { ok: false; reason: string }> {
    const result = await this.request<ProcessGroupList>('SYNO.Core.System.ProcessGroup', 1, 'list')
    if (!result.ok) return result
    return { ok: true, data: result.data.slices ?? [] }
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.host}/${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    return url.toString()
  }
}
