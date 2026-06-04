import type { SynoEnvelope, SynoAuthData, SynologyConfig, ReachabilityResult, Task, SynoTaskListData, SystemUtilization, StorageInfo, DiskInfo, DiskEntry, SharedFolder, FolderEntry, SynoStorageLoadInfo, ProcessGroupList, ProcessGroupSlice, InspectListData } from './types.ts'
import { ok, type Result } from '../../lib/result.ts'

const PATH_ENTRY = 'webapi/entry.cgi'
const PATH_DOWNLOAD_TASK = 'webapi/DownloadStation/task.cgi'
const PATH_DOWNLOAD_INFO = 'webapi/DownloadStation/info.cgi'

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

/**
 * Build the JSON-string-quoted params DS2 `entry.cgi` insists on.
 *
 * DS2 misreads plain values, so `type` must be the string `"url"`, `url` a JSON
 * array `["…"]`, `destination` a quoted `"…"`, and `list_id`/`selected` JSON.
 * Centralising the quoting here removes the 3× foot-gun previously duplicated in
 * `createDownloadTask` / `createInspectList` / `commitInspectList`.
 *
 * Two shapes:
 *   - create:  `{ uri, destination, createList }` → `SYNO.DownloadStation2.Task` `create`
 *   - commit:  `{ listId, selected, destination }` → `SYNO.DownloadStation2.Task.List` `download`
 */
export function ds2CreateParams(
  args:
    | { uri: string; destination: string; createList: boolean }
    | { listId: string; selected: number[]; destination: string },
): Record<string, string> {
  const destination = `"${normalizeDownloadDestination(args.destination)}"`
  if ('uri' in args) {
    return {
      create_list: args.createList ? 'true' : 'false',
      type: '"url"',
      url: JSON.stringify([args.uri]),
      destination,
    }
  }
  return {
    list_id: JSON.stringify(args.listId),
    selected: JSON.stringify(args.selected),
    destination,
  }
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

  async listTasks(): Promise<Result<Task[]>> {
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

  async pauseTask(taskId: string): Promise<Result> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'pause', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async resumeTask(taskId: string): Promise<Result> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'resume', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async deleteTask(taskId: string, deleteFiles = false): Promise<Result> {
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
  ): Promise<Result> {
    const result = await this.request<unknown>(
      'SYNO.DownloadStation2.Task',
      2,
      'create',
      ds2CreateParams({ uri, destination, createList: false }),
    )
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * Per-file selection — step 1 of 3. Inspect a torrent WITHOUT downloading it:
   * DS2 `create` with `create_list:true` parses the torrent into a transient
   * "list" (a `list_id`) we can read the file tree from, then commit a subset.
   *
   * ⚠️ Verified live 2026-06-03 (see memory reference-ds2-selective-download).
   * `uri` is a magnet / HTTP `.torrent` link (incl. our self-hosted
   * `/torrent-file/<token>.torrent` for held bytes). DSM fetches + parses it,
   * so the call can take several seconds. Returns the `list_id`.
   */
  async createInspectList(
    uri: string,
    destination: string
  ): Promise<{ ok: true; listId: string } | Extract<Result, { ok: false }>> {
    const result = await this.request<{ list_id?: string[] }>(
      'SYNO.DownloadStation2.Task',
      2,
      'create',
      ds2CreateParams({ uri, destination, createList: true }),
    )
    if (!result.ok) return result
    const listId = result.data.list_id?.[0]
    if (!listId) return { ok: false, reason: 'DownloadStation returned no list_id' }
    return { ok: true, listId }
  }

  /**
   * Per-file selection — step 2 of 3. Read the parsed file tree for a `list_id`.
   * `SYNO.DownloadStation2.Task.List` `get` (NOT `…List.Polling`, which errors).
   * The torrent's metadata may take a few seconds after createInspectList, so
   * the caller polls until `files` is non-empty. `list_id` is a JSON string.
   */
  async getInspectList(
    listId: string
  ): Promise<Result<InspectListData>> {
    return this.request<InspectListData>('SYNO.DownloadStation2.Task.List', 2, 'get', {
      list_id: JSON.stringify(listId),
    })
  }

  /**
   * Per-file selection — step 3 of 3. Commit the chosen files into a real
   * download task. `SYNO.DownloadStation2.Task.List` **`download`** (the only
   * method that commits — `create`/`set`/`apply` all error 103). `selected` is
   * the JSON array of file indices to KEEP. Verified the selection is honored
   * (a 1-file commit downloads only that file).
   */
  async commitInspectList(
    listId: string,
    selected: number[],
    destination: string
  ): Promise<Result> {
    const result = await this.request<{ task_id?: string[] }>(
      'SYNO.DownloadStation2.Task.List',
      2,
      'download',
      ds2CreateParams({ listId, selected, destination }),
    )
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * Abandon an un-committed inspect list (user cancelled). `Task.List` `delete`
   * wants `list_id` as a JSON **array**. Best-effort — after a commit the
   * list_id is already consumed and this is a no-op.
   */
  async deleteInspectList(listId: string): Promise<Result> {
    const result = await this.request<unknown>('SYNO.DownloadStation2.Task.List', 2, 'delete', {
      list_id: JSON.stringify([listId]),
    })
    if (!result.ok) return result
    return { ok: true }
  }

  /**
   * Ensure DownloadStation has a non-empty `default_destination`.
   *
   * ⚠️ ROOT CAUSE of the long "task created but never starts / waiting / size=0"
   * bug (verified live 2026-06-03): when `default_destination` is null/empty the
   * DSM engine *accepts* an API `create` (returns a task_id) but **never starts
   * ANY task** — torrent or plain HTTP, any add method. The DSM web UI's add
   * dialog sets the default as a side effect of picking a folder, which is why
   * manual adds "worked" while every API add stalled. We never set it, so a NAS
   * whose default was never configured (or got reset by a DSM update) silently
   * stalls every download.
   *
   * Called once at startup (after login). If the default is missing we set it to
   * a real share (prefers `video`, else the first share). Per-task `destination`
   * still overrides it — the global default just has to be non-empty for the
   * scheduler to run anything. Idempotent and best-effort: a failure here is
   * logged by the caller, not fatal.
   */
  async ensureDefaultDestination(): Promise<
    { ok: true; destination: string; changed: boolean } | Extract<Result, { ok: false }>
  > {
    const cfg = await this.request<{ default_destination: string | null }>(
      'SYNO.DownloadStation.Info',
      1,
      'getconfig',
      {},
      PATH_DOWNLOAD_INFO,
    )
    if (!cfg.ok) return cfg

    const current = cfg.data.default_destination
    if (current && current.trim() !== '') {
      return { ok: true, destination: current, changed: false }
    }

    const shares = await this.listSharedFolders()
    if (!shares.ok) return shares
    const preferred = shares.data.find((s) => s.name === 'video') ?? shares.data[0]
    if (!preferred) return { ok: false, reason: 'no shared folders available to use as default destination' }

    const set = await this.request<unknown>(
      'SYNO.DownloadStation.Info',
      1,
      'setserverconfig',
      { default_destination: preferred.name },
      PATH_DOWNLOAD_INFO,
    )
    if (!set.ok) return set
    return { ok: true, destination: preferred.name, changed: true }
  }

  async listSharedFolders(): Promise<Result<SharedFolder[]>> {
    const result = await this.request<{ shares: SharedFolder[] }>('SYNO.FileStation.List', 2, 'list_share', {})
    if (!result.ok) return result
    return { ok: true, data: result.data.shares ?? [] }
  }

  async listFolders(folderPath: string): Promise<Result<FolderEntry[]>> {
    const result = await this.request<{ files: FolderEntry[] }>('SYNO.FileStation.List', 2, 'list', {
      folder_path: folderPath,
      filetype: 'dir',
    })
    if (!result.ok) return result
    return { ok: true, data: result.data.files ?? [] }
  }

  async getSystemUtilization(): Promise<Result<SystemUtilization>> {
    return this.request<SystemUtilization>('SYNO.Core.System.Utilization', 1, 'get')
  }

  async getStorageInfo(): Promise<Result<StorageInfo>> {
    const result = await this.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    return { ok: true, data: { volumes: result.data.volumes ?? [] } }
  }

  async getDiskInfo(): Promise<Result<DiskInfo>> {
    const result = await this.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    const disks: DiskEntry[] = (result.data.disks ?? []).map(d => ({
      ...d,
      temperature_status: classifyTemp(d.temp),
    }))
    return { ok: true, data: { disks } }
  }

  async getProcessGroups(): Promise<Result<ProcessGroupSlice[]>> {
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
