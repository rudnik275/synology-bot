/**
 * NAS health route: aggregate system utilization, storage, disks, processes.
 * Resilient: each section fetched independently; failed section comes back null
 * with its reason in `errors`, so the NAS tab still renders the rest.
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { SynologyClient } from '../../infra/synology/client.ts'
import {
  serializeCpu,
  serializeMemory,
  serializeVolumes,
  serializeDisks,
  serializeProcesses,
} from '../serializers.ts'

export interface HealthRouteDeps {
  synology: SynologyClient
}

export function registerHealthRoute(app: Hono<AppEnv>, deps: HealthRouteDeps): void {
  const { synology } = deps

  app.get('/api/health', async (c) => {
    const [utilization, storage, disks, processGroups] = await Promise.all([
      synology.getSystemUtilization(),
      synology.getStorageInfo(),
      synology.getDiskInfo(),
      synology.getProcessGroups(),
    ])
    const errors = [
      !utilization.ok ? { section: 'utilization', reason: utilization.reason } : null,
      !storage.ok ? { section: 'storage', reason: storage.reason } : null,
      !disks.ok ? { section: 'disks', reason: disks.reason } : null,
      !processGroups.ok ? { section: 'processGroups', reason: processGroups.reason } : null,
    ].filter((e) => e !== null)

    return c.json({
      cpu: utilization.ok ? serializeCpu(utilization.data) : null,
      memory: utilization.ok ? serializeMemory(utilization.data) : null,
      volumes: storage.ok ? serializeVolumes(storage.data) : null,
      disks: disks.ok ? serializeDisks(disks.data) : null,
      processes: processGroups.ok ? serializeProcesses(processGroups.data) : null,
      errors,
    })
  })
}
