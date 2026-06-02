import type { SynoEnvelope, SynoAuthData, SynologyConfig, ReachabilityResult, Task, SynoTaskListData, SystemUtilization, StorageInfo, DiskInfo, DiskEntry, SharedFolder, FolderEntry, SynoDownloadTaskCreateData, SynoStorageLoadInfo, ProcessGroupList, ProcessGroupSlice, SynoTaskListGetData, TaskListFile, TaskInspectResult } from './types.ts'

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

/**
 * A browser-style multipart boundary. DSM 7's `entry.cgi` multipart parser
 * SILENTLY DROPS every form field unless the boundary looks like a browser's
 * (`----WebKitFormBoundary…` / `----geckoformboundary…`). Bun's `FormData` (and
 * other libraries) emit a generic boundary, so DSM read zero fields — including
 * `_sid` and `type` — and every .torrent add / inspect failed with code 119
 * then 120. Verified on the live NAS: a browser-shaped boundary makes the exact
 * same payload succeed. (curl `-F` and `requests` hit this too; the synology-api
 * library carries a `generate_gecko_boundary()` for precisely this reason.)
 */
function browserBoundary(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  const hex = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  return `----WebKitFormBoundary${hex}`
}

/**
 * Encode text fields + one file part into a `multipart/form-data` body using a
 * browser-style boundary (see {@link browserBoundary}). Returns the raw bytes
 * and the matching `Content-Type` header to send alongside them. We build the
 * body by hand (rather than `FormData`) so we control the boundary.
 */
function buildBrowserMultipart(
  fields: Array<[string, string]>,
  file: { partName: string; fileName: string; contentType: string; bytes: Uint8Array },
): { body: Uint8Array; contentType: string } {
  const boundary = browserBoundary()
  const enc = new TextEncoder()
  const head: Uint8Array[] = []
  for (const [k, v] of fields) {
    head.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  head.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.partName}"; ` +
        `filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
  )
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const total = head.reduce((n, c) => n + c.length, 0) + file.bytes.length + tail.length
  const body = new Uint8Array(total)
  let off = 0
  for (const c of head) {
    body.set(c, off)
    off += c.length
  }
  body.set(file.bytes, off)
  off += file.bytes.length
  body.set(tail, off)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
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

  async createDownloadTask(
    magnet: string,
    destination: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.request<unknown>('SYNO.DownloadStation.Task', 1, 'create', {
      uri: magnet,
      destination: normalizeDownloadDestination(destination),
    }, PATH_DOWNLOAD_TASK)
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

  /**
   * Creates a whole-torrent Download Task from a .torrent file's bytes via the
   * DownloadStation2 file-create (`create_list=false`). See {@link submitCreateFromFile}
   * for the DSM-7 multipart quirks (browser boundary, `_sid` in the query).
   */
  async createDownloadTaskFromFile(
    bytes: Uint8Array,
    fileName: string,
    destination: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sub = await this.submitCreateFromFile(bytes, fileName, destination, false)
    if (!sub.ok) return sub
    const json = sub.json
    if (!json.success) {
      const code = json.error?.code
      console.error('[synology] create failed', { destination: normalizeDownloadDestination(destination), code, error: json.error })
      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}${json.error ? ` ${JSON.stringify(json.error)}` : ''}` }
    }
    return { ok: true }
  }

  /**
   * Build + POST a DownloadStation2 `create` from a .torrent file and return the
   * parsed envelope. Encodes the DSM-7 contract that took a live-NAS probe to pin
   * down:
   *   - the params (`api`/`version`/`method`/`type`/`destination`/`create_list`/
   *     `file`) and the file go in a `multipart/form-data` body with a
   *     BROWSER-STYLE boundary — DSM drops every field otherwise (see
   *     {@link buildBrowserMultipart});
   *   - `_sid` travels in the QUERY string (DSM ignores it in the body);
   *   - `file` is the JSON array `["torrent"]` naming the part that holds the
   *     bytes, which is sent as a separate part literally named `torrent`.
   * `createList` flips whole-torrent add (`false`) vs inspect (`true`). A 45s
   * timeout keeps a hung NAS from becoming an opaque Cloudflare 502; a code-119
   * (session expired) result triggers one re-login + retry with a fresh sid.
   */
  private async submitCreateFromFile(
    bytes: Uint8Array,
    fileName: string,
    destination: string,
    createList: boolean,
    retry = false,
  ): Promise<{ ok: true; json: SynoEnvelope<SynoDownloadTaskCreateData> } | { ok: false; reason: string }> {
    const normalizedDestination = normalizeDownloadDestination(destination)
    const { body, contentType } = buildBrowserMultipart(
      [
        ['api', 'SYNO.DownloadStation2.Task'],
        ['version', '2'],
        ['method', 'create'],
        ['type', '"file"'],
        ['destination', `"${normalizedDestination}"`],
        ['create_list', createList ? 'true' : 'false'],
        ['file', '["torrent"]'],
      ],
      { partName: 'torrent', fileName, contentType: 'application/x-bittorrent', bytes },
    )
    const url = `${this.host}/webapi/entry.cgi?_sid=${encodeURIComponent(this.sid ?? '')}`
    const label = retry ? 'create(retry)' : 'create'
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(45000) })
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Synology did not respond within 45s (DownloadStation busy or unreachable)'
          : `Synology request failed: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[synology] ${label} request error:`, reason)
      return { ok: false, reason }
    }
    let json: SynoEnvelope<SynoDownloadTaskCreateData>
    try {
      json = (await res.json()) as SynoEnvelope<SynoDownloadTaskCreateData>
    } catch {
      console.error(`[synology] ${label} non-JSON response: HTTP ${res.status}`)
      return { ok: false, reason: `Synology returned a non-JSON response (HTTP ${res.status})` }
    }
    if (!json.success && json.error?.code === 119 && !retry) {
      // Session expired — re-login once and retry with a fresh sid in the query.
      await this.login()
      return this.submitCreateFromFile(bytes, fileName, destination, createList, true)
    }
    return { ok: true, json }
  }

  // ─── DownloadStation2 selective-download (two-phase: inspect → select → commit) ───
  //
  // Verified on the live NAS (DSM 7). The flow is: create with create_list=true
  // (INSPECTING, not downloading) → read the file list → set the wanted subset
  // via BT.File → Complete to start only the selected files. Backing out before
  // Complete leaves an orphaned inspecting task — cancelTaskList cleans it up.
  //
  // Transport (#1, pinned on the live NAS): create-from-file is a browser-boundary
  // multipart with _sid in the query (see browserBoundary); the list/select/
  // complete/cancel calls carry their params in the query string. Both shapes
  // were exercised against a real write — a generic-boundary body or body-borne
  // params silently drop every field (error 119/120) and nothing is created.

  /**
   * Phase 1+2: create an INSPECTING BT task (create_list=true) from a .torrent's
   * bytes, then read its file list. Returns the `list_id` (needed to commit or
   * cancel) plus the normalized file list. For magnets/torrents whose metadata
   * is still resolving server-side, the list comes back empty + `inspecting`;
   * we poll `Task.List get` up to `maxPolls` times. An empty list after polling
   * is returned as-is (the caller decides whether to fall back to a whole add).
   */
  async inspectTaskFromFile(
    bytes: Uint8Array,
    fileName: string,
    destination: string,
    opts: { pollDelayMs?: number; maxPolls?: number } = {},
  ): Promise<{ ok: true; data: TaskInspectResult } | { ok: false; reason: string }> {
    const sub = await this.submitCreateFromFile(bytes, fileName, destination, true)
    if (!sub.ok) return sub
    const json = sub.json
    if (!json.success) {
      const code = json.error?.code
      console.error('[synology] inspect failed', { code, error: json.error })
      return { ok: false, reason: `Synology error code ${code ?? 'unknown'}${json.error ? ` ${JSON.stringify(json.error)}` : ''}` }
    }
    const listId = json.data?.list_id?.[0]
    if (!listId) return { ok: false, reason: 'Synology returned no list_id for the inspecting task' }

    const files = await this.pollTaskList(listId, opts)
    if (!files.ok) return files
    return { ok: true, data: { listId, files: files.data } }
  }

  /** Read the file list of an inspecting task (`Task.List get`), normalized.
   *  Params go in the query (entry.cgi drops multipart-body fields, see
   *  {@link browserBoundary}); only the create-from-file calls use a body. */
  async getTaskListFiles(
    listId: string,
  ): Promise<{ ok: true; data: TaskListFile[]; inspecting: boolean } | { ok: false; reason: string }> {
    const res = await this.request<SynoTaskListGetData>(
      'SYNO.DownloadStation2.Task.List', 2, 'get', { list_id: `"${listId}"` },
    )
    if (!res.ok) return res
    const files: TaskListFile[] = (res.data.files ?? []).map((f, i) => ({
      index: f.index ?? i,
      path: f.path ?? f.name ?? '',
      size: typeof f.size === 'string' ? Number(f.size) || 0 : f.size ?? 0,
    }))
    return { ok: true, data: files, inspecting: res.data.inspecting === true }
  }

  /** Poll `Task.List get` until files appear (or `inspecting` clears), up to maxPolls. */
  private async pollTaskList(
    listId: string,
    opts: { pollDelayMs?: number; maxPolls?: number },
  ): Promise<{ ok: true; data: TaskListFile[] } | { ok: false; reason: string }> {
    const maxPolls = opts.maxPolls ?? 20
    const pollDelayMs = opts.pollDelayMs ?? 500
    let last: TaskListFile[] = []
    for (let i = 0; i < maxPolls; i++) {
      const res = await this.getTaskListFiles(listId)
      if (!res.ok) return res
      last = res.data
      if (res.data.length > 0 && !res.inspecting) return { ok: true, data: res.data }
      if (res.data.length > 0 && res.inspecting === false) return { ok: true, data: res.data }
      // Still resolving metadata — wait and retry.
      if (i < maxPolls - 1 && pollDelayMs > 0) {
        await new Promise((r) => setTimeout(r, pollDelayMs))
      }
    }
    return { ok: true, data: last }
  }

  /** Cancel an uncommitted inspecting list (`Task.List delete`). */
  async cancelTaskList(listId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const res = await this.request<unknown>(
      'SYNO.DownloadStation2.Task.List', 2, 'delete', { list_id: `"${listId}"` },
    )
    if (!res.ok) return res
    return { ok: true }
  }

  /**
   * Commit an inspecting list: start downloading the selected file subset via
   * `SYNO.DownloadStation2.Task.List.Polling` `download`. Verified on the live
   * NAS — this single call IS the selective-download commit. (The earlier
   * `BT.File set` + `Complete start` pair was a wrong guess: `BT.File` rejects a
   * list_id with 404 and `Complete` wants a different `id`.) `download` needs
   * `list_id` + `file_indexes` (comma-separated) + `destination` (REQUIRED — the
   * list's own destination isn't reused here) and returns a task_id.
   */
  async commitTaskSubset(
    listId: string,
    indices: number[],
    destination: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const res = await this.request<unknown>(
      'SYNO.DownloadStation2.Task.List.Polling', 2, 'download', {
        list_id: `"${listId}"`,
        file_indexes: indices.join(','),
        destination: `"${normalizeDownloadDestination(destination)}"`,
        create_subfolder: 'false',
      },
    )
    if (!res.ok) return res
    return { ok: true }
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
