import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import type { SynologyClient } from '../infra/synology/client.ts'
import type { TolokaClient } from '../infra/toloka/client.ts'
import type { DockerClient } from '../infra/docker/client.ts'
import { parseLastSessionDone } from '../infra/docker/client.ts'
import type { Subscription } from '../domain/subscription.ts'
import { ownerAuth, type AppEnv } from './auth.ts'
import {
  serializeTask,
  serializeSearchResult,
  serializeSubscription,
  serializeCpu,
  serializeMemory,
  serializeVolumes,
  serializeDisks,
  serializeProcesses,
} from './serializers.ts'

/** Narrow slice of PersistentStore the subscriptions endpoints need. */
export interface SubscriptionStore {
  listSubscriptions(): Subscription[]
  getSubscription(id: string): Subscription | undefined
  addSubscription(sub: Subscription): void
  removeSubscription(id: string): void
}

/** Narrow slice of PersistentStore the torrent-stash endpoint reads (#99). */
export interface TorrentStashReader {
  getTorrentStash(token: string): { fileName: string; data: Uint8Array } | undefined
}

/** One episode airing today, as returned by the injected fetcher. */
export interface TodayEpisode {
  season: number
  episode: number
  title: string
  airTime: string
}

export interface ServerDeps {
  synology: SynologyClient
  toloka: TolokaClient
  docker: DockerClient
  store: SubscriptionStore
  /** Resolve a myshows.me show's title; injected for testability. */
  getShowById: (showId: number) => Promise<{ title: string }>
  /** Episodes airing today for a show; injected for testability. */
  getTodayEpisodes: (showId: number) => Promise<TodayEpisode[]>
  /** Base URL of the Toloka tracker — used to route Toloka download URLs through an authenticated fetch. */
  tolokaBaseUrl: string
  botToken: string
  ownerId: number
  /** Max initData age in seconds; 0 disables the freshness check. */
  initDataMaxAgeSeconds?: number
  /** Reader for .torrent files stashed by the bot (#99); absent in tests that don't exercise it. */
  torrentStash?: TorrentStashReader
  /**
   * Filesystem root of the built Vue SPA (Vite `dist`), resolved relative to
   * the process CWD. The API and /healthz are registered first and win; any
   * other path falls back to index.html for client-side routing. Defaults to
   * the production layout; tests point it at a fixture.
   */
  staticRoot?: string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A Toloka download URL needs an authenticated fetch — DSM can't pull it itself (it'd hit the login page). */
function isTolokaUrl(uri: string, tolokaBaseUrl: string): boolean {
  try {
    return new URL(uri).host === new URL(tolokaBaseUrl).host
  } catch {
    return false
  }
}

/**
 * The Mini App backend (ADR 0005). A JSON API over the existing infra layer,
 * meant to run on loopback behind a Cloudflare Tunnel. Everything under /api
 * is gated by owner-signed Telegram initData; /healthz is an open liveness probe.
 *
 * Responses follow the frozen contract of epic #58 (normalized shapes, not raw
 * DSM/Toloka JSON) — serialization lives in ./serializers.ts. Upstream
 * (NAS / Toloka) failures map to 502; bad client input maps to 400.
 */
export function createServer(deps: ServerDeps): Hono<AppEnv> {
  const { synology, toloka, docker, store, getShowById, getTodayEpisodes, tolokaBaseUrl } = deps
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
    return c.json({ tasks: result.data.map(serializeTask) })
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

  // --- Tasks: create (unified, per #58) ---
  // Accepts either JSON {uri,destination} (magnet or URL) or a multipart
  // {file,destination} (.torrent upload). Toloka URLs are fetched with auth;
  // magnets and plain URLs are handed straight to DownloadStation.

  app.post('/api/tasks', async (c) => {
    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
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
    }

    const body = await c.req.json().catch(() => null)
    const uri = body?.uri
    const destination = body?.destination
    if (typeof uri !== 'string' || !uri || typeof destination !== 'string' || !destination) {
      return c.json({ error: 'uri and destination are required' }, 400)
    }

    if (!uri.startsWith('magnet:') && isTolokaUrl(uri, tolokaBaseUrl)) {
      let bytes: Uint8Array
      try {
        bytes = await toloka.downloadTorrent(uri)
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 502)
      }
      const title = typeof body?.title === 'string' && body.title ? body.title : 'download'
      const result = await synology.createDownloadTaskFromFile(bytes, `${title}.torrent`, destination)
      if (!result.ok) return c.json({ error: result.reason }, 502)
      return c.json({ ok: true }, 201)
    }

    const result = await synology.createDownloadTask(uri, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  // --- Torrent stash (#99): fetch a .torrent the bot stashed by token ---
  // The Mini App reconstructs a File from the base64 payload and runs it
  // through the normal createTaskFromFile path. Idempotent; the stash ages out
  // by its own TTL. Sits under the /api/* owner guard — the token is a fetch
  // key, not a capability.

  app.get('/api/torrent-stash/:token', (c) => {
    const stash = deps.torrentStash?.getTorrentStash(c.req.param('token'))
    if (!stash) return c.json({ error: 'not found' }, 404)
    return c.json({ name: stash.fileName, base64: Buffer.from(stash.data).toString('base64') })
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
      return c.json({ results: results.map(serializeSearchResult) })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
  })

  // --- NAS health ---
  // Resilient: each section is fetched independently; a failed section comes
  // back null with its reason in `errors`, so the NAS tab still renders the rest.

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

  // --- Subscriptions ---

  app.get('/api/subscriptions', (c) =>
    c.json({ subscriptions: store.listSubscriptions().map(serializeSubscription) })
  )

  app.get('/api/subscriptions/today', async (c) => {
    const episodes: Array<{
      showId: number
      title: string
      season: number
      episode: number
      airTime: string
    }> = []
    for (const sub of store.listSubscriptions()) {
      const today = await getTodayEpisodes(sub.showId)
      for (const ep of today) {
        episodes.push({
          showId: sub.showId,
          title: sub.title,
          season: ep.season,
          episode: ep.episode,
          airTime: ep.airTime,
        })
      }
    }
    return c.json({ episodes })
  })

  app.post('/api/subscriptions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const showId = Number(body?.showId)
    if (!Number.isInteger(showId)) {
      return c.json({ error: 'showId (integer) is required' }, 400)
    }
    const existing = store.getSubscription(String(showId))
    if (existing) return c.json({ subscription: serializeSubscription(existing) })

    let title: string
    try {
      title = (await getShowById(showId)).title
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
    const sub: Subscription = { id: String(showId), showId, title }
    store.addSubscription(sub)
    return c.json({ subscription: serializeSubscription(sub) }, 201)
  })

  app.delete('/api/subscriptions/:id', (c) => {
    const id = c.req.param('id')
    const existing = store.getSubscription(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    store.removeSubscription(id)
    return c.json({ ok: true })
  })

  // --- Deploy status (Watchtower) ---
  // Not in the #58 contract; kept as a documented extra (the bot self-reports
  // deploys, and the NAS tab surfaces the last Watchtower check).

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

  // --- Static SPA (Phase 3) ---
  // Registered last so /api and /healthz keep priority. Built assets are
  // served from `staticRoot`; every other (non-API) path falls back to
  // index.html for client-side routing.
  const staticRoot = deps.staticRoot ?? './frontend/dist'
  app.use('/assets/*', serveStatic({ root: staticRoot }))
  app.get('*', serveStatic({ path: `${staticRoot}/index.html` }))

  return app
}
