import type { SharedFolder, FolderEntry } from './types.ts'
import type { Result } from '../../lib/result.ts'
import { SynoTransport } from './transport.ts'

/**
 * FileStation folder browsing: shared folders (volume roots) and their
 * subfolders. Shares the SynoTransport with the other grouped APIs.
 */
export class FileStationApi {
  constructor(private readonly transport: SynoTransport) {}

  async listSharedFolders(): Promise<Result<SharedFolder[]>> {
    const result = await this.transport.request<{ shares: SharedFolder[] }>('SYNO.FileStation.List', 2, 'list_share', {})
    if (!result.ok) return result
    return { ok: true, data: result.data.shares ?? [] }
  }

  async listFolders(folderPath: string): Promise<Result<FolderEntry[]>> {
    const result = await this.transport.request<{ files: FolderEntry[] }>('SYNO.FileStation.List', 2, 'list', {
      folder_path: folderPath,
      filetype: 'dir',
    })
    if (!result.ok) return result
    return { ok: true, data: result.data.files ?? [] }
  }
}
