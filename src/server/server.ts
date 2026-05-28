import { Hono } from 'hono'
import type { SynologyClient } from '../infra/synology/client.ts'
import { ownerAuth, type AppEnv } from './auth.ts'

export interface ServerDeps {
  synology: SynologyClient
  botToken: string
  ownerId: number
  /** Max initData age in seconds; 0 disables the freshness check. */
  initDataMaxAgeSeconds?: number
}

/**
 * The Mini App backend (ADR 0005). A JSON API over the existing infra layer,
 * meant to run on loopback behind a Cloudflare Tunnel. Everything under /api
 * is gated by owner-signed Telegram initData; /healthz is an open liveness probe.
 */
export function createServer(deps: ServerDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/healthz', (c) => c.json({ ok: true }))

  app.use(
    '/api/*',
    ownerAuth({ botToken: deps.botToken, ownerId: deps.ownerId, maxAgeSeconds: deps.initDataMaxAgeSeconds })
  )

  app.get('/api/tasks', async (c) => {
    const result = await deps.synology.listTasks()
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ tasks: result.data })
  })

  app.get('/api/health', async (c) => {
    const [utilization, storage, disks, processGroups] = await Promise.all([
      deps.synology.getSystemUtilization(),
      deps.synology.getStorageInfo(),
      deps.synology.getDiskInfo(),
      deps.synology.getProcessGroups(),
    ])
    const errors = [
      !utilization.ok ? { section: 'utilization', reason: utilization.reason } : null,
      !storage.ok ? { section: 'storage', reason: storage.reason } : null,
      !disks.ok ? { section: 'disks', reason: disks.reason } : null,
      !processGroups.ok ? { section: 'processGroups', reason: processGroups.reason } : null,
    ].filter((e) => e !== null)

    return c.json({
      utilization: utilization.ok ? utilization.data : null,
      storage: storage.ok ? storage.data : null,
      disks: disks.ok ? disks.data : null,
      processGroups: processGroups.ok ? processGroups.data : null,
      errors,
    })
  })

  return app
}
