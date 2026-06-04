import type {
  SystemUtilization,
  StorageInfo,
  DiskInfo,
  DiskEntry,
  SynoStorageLoadInfo,
  ProcessGroupList,
  ProcessGroupSlice,
} from './types.ts'
import type { Result } from '../../lib/result.ts'
import { SynoTransport } from './transport.ts'

/** Synology HDD temperature classification, synthesised from numeric `temp` (°C). */
function classifyTemp(t: number): 'normal' | 'warning' | 'critical' {
  if (t >= 56) return 'critical'
  if (t >= 50) return 'warning'
  return 'normal'
}

/**
 * System health readouts: CPU/memory utilization, storage volumes, disk SMART
 * + temperature, and per-slice process groups. Shares the SynoTransport with
 * the other grouped APIs.
 */
export class SystemHealthApi {
  constructor(private readonly transport: SynoTransport) {}

  async getSystemUtilization(): Promise<Result<SystemUtilization>> {
    return this.transport.request<SystemUtilization>('SYNO.Core.System.Utilization', 1, 'get')
  }

  async getStorageInfo(): Promise<Result<StorageInfo>> {
    const result = await this.transport.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    return { ok: true, data: { volumes: result.data.volumes ?? [] } }
  }

  async getDiskInfo(): Promise<Result<DiskInfo>> {
    const result = await this.transport.request<SynoStorageLoadInfo>('SYNO.Storage.CGI.Storage', 1, 'load_info')
    if (!result.ok) return result
    const disks: DiskEntry[] = (result.data.disks ?? []).map((d) => ({
      ...d,
      temperature_status: classifyTemp(d.temp),
    }))
    return { ok: true, data: { disks } }
  }

  async getProcessGroups(): Promise<Result<ProcessGroupSlice[]>> {
    const result = await this.transport.request<ProcessGroupList>('SYNO.Core.System.ProcessGroup', 1, 'list')
    if (!result.ok) return result
    return { ok: true, data: result.data.slices ?? [] }
  }
}
