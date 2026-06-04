import type { Task, SynoTaskListData } from './types.ts'
import type { Result } from '../../lib/result.ts'
import { SynoTransport, PATH_DOWNLOAD_TASK } from './transport.ts'
import { ds2CreateParams } from './ds2-params.ts'

/**
 * DownloadStation task operations: list/pause/resume/delete and the DS2
 * `create`-from-URL add. Shares the SynoTransport with the other grouped APIs.
 */
export class DownloadTasksApi {
  constructor(private readonly transport: SynoTransport) {}

  async listTasks(): Promise<Result<Task[]>> {
    const result = await this.transport.request<SynoTaskListData>(
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
    const result = await this.transport.request<unknown>('SYNO.DownloadStation.Task', 1, 'pause', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async resumeTask(taskId: string): Promise<Result> {
    const result = await this.transport.request<unknown>('SYNO.DownloadStation.Task', 1, 'resume', {
      id: taskId,
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
  }

  async deleteTask(taskId: string, deleteFiles = false): Promise<Result> {
    const result = await this.transport.request<unknown>('SYNO.DownloadStation.Task', 1, 'delete', {
      id: taskId,
      force_complete: 'false',
      delete_files: deleteFiles ? 'true' : 'false',
    }, PATH_DOWNLOAD_TASK)
    if (!result.ok) return result
    return { ok: true }
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
  async createDownloadTask(uri: string, destination: string): Promise<Result> {
    const result = await this.transport.request<unknown>(
      'SYNO.DownloadStation2.Task',
      2,
      'create',
      ds2CreateParams({ uri, destination, createList: false }),
    )
    if (!result.ok) return result
    return { ok: true }
  }
}
