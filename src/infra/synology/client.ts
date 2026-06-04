import type {
  SynologyConfig,
  ReachabilityResult,
  Task,
  SystemUtilization,
  StorageInfo,
  DiskInfo,
  SharedFolder,
  FolderEntry,
  ProcessGroupSlice,
  InspectListData,
} from './types.ts'
import type { Result } from '../../lib/result.ts'
import { SynoTransport, PATH_DOWNLOAD_INFO } from './transport.ts'
import { DownloadTasksApi } from './download-tasks-api.ts'
import { InspectListApi } from './inspect-list-api.ts'
import { SystemHealthApi } from './system-health-api.ts'
import { FileStationApi } from './file-station-api.ts'

// Re-exported so existing call sites/tests that import these from the client
// keep working — the public module surface is unchanged.
export { normalizeDownloadDestination, ds2CreateParams } from './ds2-params.ts'

/**
 * Facade over the DSM API — one door for the rest of the app. Behind it sit a
 * shared `SynoTransport` (login/session/send/retry) and grouped APIs:
 * `DownloadTasksApi`, `InspectListApi`, `SystemHealthApi`, `FileStationApi`.
 * Every public method below is a thin delegation, so call sites (server.ts,
 * handlers/routes/health.ts, the domain watchers) are unchanged.
 */
export class SynologyClient {
  private readonly transport: SynoTransport
  private readonly downloadTasks: DownloadTasksApi
  private readonly inspectList: InspectListApi
  private readonly systemHealth: SystemHealthApi
  private readonly fileStation: FileStationApi

  constructor(config: SynologyConfig) {
    this.transport = new SynoTransport(config)
    this.downloadTasks = new DownloadTasksApi(this.transport)
    this.inspectList = new InspectListApi(this.transport)
    this.systemHealth = new SystemHealthApi(this.transport)
    this.fileStation = new FileStationApi(this.transport)
  }

  // ── session ────────────────────────────────────────────────────────────────

  login(): Promise<void> {
    return this.transport.login()
  }

  /**
   * Low-level escape hatch retained for backward compatibility. Prefer the
   * grouped methods below; this just forwards to the transport.
   */
  request<T>(
    api: string,
    version: number,
    method: string,
    params: Record<string, string | number> = {},
    path?: string,
  ): Promise<Result<T>> {
    return this.transport.request<T>(api, version, method, params, path)
  }

  async isReachable(): Promise<ReachabilityResult> {
    try {
      const result = await this.transport.request<unknown>('SYNO.API.Info', 1, 'query', { query: 'all' }, 'webapi/query.cgi')
      if (result.ok) return { ok: true }
      return result
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { ok: false, reason }
    }
  }

  // ── download tasks ───────────────────────────────────────────────────────────

  listTasks(): Promise<Result<Task[]>> {
    return this.downloadTasks.listTasks()
  }

  pauseTask(taskId: string): Promise<Result> {
    return this.downloadTasks.pauseTask(taskId)
  }

  resumeTask(taskId: string): Promise<Result> {
    return this.downloadTasks.resumeTask(taskId)
  }

  deleteTask(taskId: string, deleteFiles = false): Promise<Result> {
    return this.downloadTasks.deleteTask(taskId, deleteFiles)
  }

  createDownloadTask(uri: string, destination: string): Promise<Result> {
    return this.downloadTasks.createDownloadTask(uri, destination)
  }

  // ── per-file inspect list ────────────────────────────────────────────────────

  createInspectList(
    uri: string,
    destination: string,
  ): Promise<{ ok: true; listId: string } | Extract<Result, { ok: false }>> {
    return this.inspectList.createInspectList(uri, destination)
  }

  getInspectList(listId: string): Promise<Result<InspectListData>> {
    return this.inspectList.getInspectList(listId)
  }

  commitInspectList(listId: string, selected: number[], destination: string): Promise<Result> {
    return this.inspectList.commitInspectList(listId, selected, destination)
  }

  deleteInspectList(listId: string): Promise<Result> {
    return this.inspectList.deleteInspectList(listId)
  }

  // ── FileStation folders ──────────────────────────────────────────────────────

  listSharedFolders(): Promise<Result<SharedFolder[]>> {
    return this.fileStation.listSharedFolders()
  }

  listFolders(folderPath: string): Promise<Result<FolderEntry[]>> {
    return this.fileStation.listFolders(folderPath)
  }

  // ── system health ────────────────────────────────────────────────────────────

  getSystemUtilization(): Promise<Result<SystemUtilization>> {
    return this.systemHealth.getSystemUtilization()
  }

  getStorageInfo(): Promise<Result<StorageInfo>> {
    return this.systemHealth.getStorageInfo()
  }

  getDiskInfo(): Promise<Result<DiskInfo>> {
    return this.systemHealth.getDiskInfo()
  }

  getProcessGroups(): Promise<Result<ProcessGroupSlice[]>> {
    return this.systemHealth.getProcessGroups()
  }

  // ── engine self-heal ─────────────────────────────────────────────────────────

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
   *
   * Lives on the facade because it spans two sub-APIs (DownloadStation.Info via
   * the transport + FileStation share listing).
   */
  async ensureDefaultDestination(): Promise<
    { ok: true; destination: string; changed: boolean } | Extract<Result, { ok: false }>
  > {
    const cfg = await this.transport.request<{ default_destination: string | null }>(
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

    const shares = await this.fileStation.listSharedFolders()
    if (!shares.ok) return shares
    const preferred = shares.data.find((s) => s.name === 'video') ?? shares.data[0]
    if (!preferred) return { ok: false, reason: 'no shared folders available to use as default destination' }

    const set = await this.transport.request<unknown>(
      'SYNO.DownloadStation.Info',
      1,
      'setserverconfig',
      { default_destination: preferred.name },
      PATH_DOWNLOAD_INFO,
    )
    if (!set.ok) return set
    return { ok: true, destination: preferred.name, changed: true }
  }
}
