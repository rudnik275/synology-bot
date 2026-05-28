import { Hono } from 'hono'
import type { SynologyClient } from '../infra/synology/client.ts'
import type { TolokaClient } from '../infra/toloka/client.ts'
import type { DockerClient } from '../infra/docker/client.ts'
import { parseLastSessionDone } from '../infra/docker/client.ts'
import type { Subscription } from '../domain/subscription.ts'
import { ownerAuth, type AppEnv } from './auth.ts'

/** Narrow slice of PersistentStore the subscriptions endpoints need. */
export interface SubscriptionStore {
  listSubscriptions(): Subscription[]
  getSubscription(id: string): Subscription | undefined
  addSubscription(sub: Subscription): void
  removeSubscription(id: string): void
}

export interface ServerDeps {
  synology: SynologyClient
  toloka: TolokaClient
  docker: DockerClient
  store: SubscriptionStore
  /** Resolve a myshows.me show's title; injected for testability. */
  getShowById: (showId: number) => Promise<{ title: string }>
  botToken: string
  ownerId: number
  /** Max initData age in seconds; 0 disables the freshness check. */
  initDataMaxAgeSeconds?: number
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The Mini App backend (ADR 0005). A JSON API over the existing infra layer,
 * meant to run on loopback behind a Cloudflare Tunnel. Everything under /api
 * is gated by owner-signed Telegram initData; /healthz is an open liveness probe.
 *
 * Endpoints return structured JSON, not Telegram strings — the frontend formats.
 * Upstream (NAS / Toloka) failures map to 502; bad client input maps to 400.
 */
export function createServer(deps: ServerDeps): Hono<AppEnv> {
  const { synology, toloka, docker, store, getShowById } = deps
  const app = new Hono<AppEnv>()

  app.get('/healthz', (c) => c.json({ ok: true }))

  app.use(
    '/api/*',
    ownerAuth({ botToken: deps.botToken, ownerId: deps.ownerId, maxAgeSeconds: deps.initDataMaxAgeSeconds })
  )

  // --- Tasks: read ---

  app.get('/api/tasks', async (c) => {
    const result = await synology.listTasks()
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ tasks: result.data })
  })

  // --- Tasks: actions ---

  app.post('/api/tasks/:id/pause', async (c) => {
    const result = await synology.pauseTask(c.req.param('id'))
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true })
  })

  app.post('/api/tasks/:id/resume', async (c) => {
    const result = await synology.resumeTask(c.req.param('id'))
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true })
  })

  app.delete('/api/tasks/:id', async (c) => {
    const deleteFiles = c.req.query('deleteFiles') === 'true'
    const result = await synology.deleteTask(c.req.param('id'), deleteFiles)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true })
  })

  // --- Tasks: create ---

  app.post('/api/tasks/magnet', async (c) => {
    const body = await c.req.json().catch(() => null)
    const magnet = body?.magnet
    const destination = body?.destination
    if (typeof magnet !== 'string' || !magnet || typeof destination !== 'string' || !destination) {
      return c.json({ error: 'magnet and destination are required' }, 400)
    }
    const result = await synology.createDownloadTask(magnet, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  app.post('/api/tasks/toloka', async (c) => {
    const body = await c.req.json().catch(() => null)
    const downloadUrl = body?.downloadUrl
    const title = body?.title
    const destination = body?.destination
    if (typeof downloadUrl !== 'string' || !downloadUrl || typeof destination !== 'string' || !destination) {
      return c.json({ error: 'downloadUrl and destination are required' }, 400)
    }
    let bytes: Uint8Array
    try {
      bytes = await toloka.downloadTorrent(downloadUrl)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
    const name = `${typeof title === 'string' && title ? title : 'toloka'}.torrent`
    const result = await synology.createDownloadTaskFromFile(bytes, name, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  app.post('/api/tasks/file', async (c) => {
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.['file']
    const destination = body?.['destination']
    if (!(file instanceof File) || typeof destination !== 'string' || !destination) {
      return c.json({ error: 'file and destination are required' }, 400)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await synology.createDownloadTaskFromFile(bytes, file.name, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  // --- Folders (destination picker) ---

  app.get('/api/folders', async (c) => {
    const path = c.req.query('path')
    const result = path ? await synology.listFolders(path) : await synology.listSharedFolders()
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ folders: result.data })
  })

  // --- Toloka search ---

  app.get('/api/search', async (c) => {
    const q = c.req.query('q')?.trim()
    if (!q) return c.json({ error: 'q is required' }, 400)
    try {
      const results = await toloka.search(q)
      return c.json({ results })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
  })

  // --- NAS health ---

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
      utilization: utilization.ok ? utilization.data : null,
      storage: storage.ok ? storage.data : null,
      disks: disks.ok ? disks.data : null,
      processGroups: processGroups.ok ? processGroups.data : null,
      errors,
    })
  })

  // --- Subscriptions ---

  app.get('/api/subscriptions', (c) => c.json({ subscriptions: store.listSubscriptions() }))

  app.post('/api/subscriptions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const showId = Number(body?.showId)
    if (!Number.isInteger(showId)) {
      return c.json({ error: 'showId (integer) is required' }, 400)
    }
    const existing = store.getSubscription(String(showId))
    if (existing) return c.json({ subscription: existing })

    let title: string
    try {
      title = (await getShowById(showId)).title
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
    const sub: Subscription = { id: String(showId), showId, title }
    store.addSubscription(sub)
    return c.json({ subscription: sub }, 201)
  })

  app.delete('/api/subscriptions/:id', (c) => {
    const id = c.req.param('id')
    const existing = store.getSubscription(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    store.removeSubscription(id)
    return c.json({ ok: true })
  })

  // --- Deploy status (Watchtower) ---

  app.get('/api/deploy-status', async (c) => {
    let container
    try {
      container = await docker.getContainerByName('watchtower')
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
    if (!container) return c.json({ state: 'not_found' })
    if (container.state !== 'running') {
      return c.json({ state: 'stopped', status: container.status })
    }
    let logs = ''
    try {
      logs = await docker.getContainerLogs('watchtower', 50)
    } catch {
      // Non-fatal: the container is running; we just can't read the last check time.
    }
    const lastCheck = parseLastSessionDone(logs)
    return c.json({
      state: 'running',
      status: container.status,
      lastCheck: lastCheck ? lastCheck.toISOString() : null,
    })
  })

  return app
}
