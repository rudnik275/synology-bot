import type { InspectListData } from './types.ts'
import type { Result } from '../../lib/result.ts'
import { SynoTransport } from './transport.ts'
import { ds2CreateParams } from './ds2-params.ts'

/**
 * Per-file selection (the 3-step DS2 inspect-list flow): create the transient
 * list, read its parsed file tree, commit a chosen subset, or abandon it.
 * Shares the SynoTransport with the other grouped APIs.
 */
export class InspectListApi {
  constructor(private readonly transport: SynoTransport) {}

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
    destination: string,
  ): Promise<{ ok: true; listId: string } | Extract<Result, { ok: false }>> {
    const result = await this.transport.request<{ list_id?: string[] }>(
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
  async getInspectList(listId: string): Promise<Result<InspectListData>> {
    return this.transport.request<InspectListData>('SYNO.DownloadStation2.Task.List', 2, 'get', {
      list_id: JSON.stringify(listId),
    })
  }

  /**
   * Per-file selection — step 3 of 3. Commit the chosen files into a real
   * download task. `SYNO.DownloadStation2.Task.List` **`download`** (the only
   * method that commits — `create`/`set`/`apply` all error 103). `selected` is
   * the JSON array of file indices to KEEP. Verified the selection is honored
   * (a 1-file commit downloads only that file).
   *
   * Returns the committed task's `id` (DSM `Task.List download` echoes a
   * `task_id`, the SAME id the list / delete APIs use). `id` is omitted when
   * DSM gives none.
   */
  async commitInspectList(
    listId: string,
    selected: number[],
    destination: string,
  ): Promise<{ ok: true; id?: string } | Extract<Result, { ok: false }>> {
    const result = await this.transport.request<{ task_id?: string[] }>(
      'SYNO.DownloadStation2.Task.List',
      2,
      'download',
      ds2CreateParams({ listId, selected, destination }),
    )
    if (!result.ok) return result
    return { ok: true, id: result.data.task_id?.[0] }
  }

  /**
   * Abandon an un-committed inspect list (user cancelled). `Task.List` `delete`
   * wants `list_id` as a JSON **array**. Best-effort — after a commit the
   * list_id is already consumed and this is a no-op.
   */
  async deleteInspectList(listId: string): Promise<Result> {
    const result = await this.transport.request<unknown>('SYNO.DownloadStation2.Task.List', 2, 'delete', {
      list_id: JSON.stringify([listId]),
    })
    if (!result.ok) return result
    return { ok: true }
  }
}
