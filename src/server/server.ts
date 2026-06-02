import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/bun'
import type { SynologyClient } from '../infra/synology/client.ts'
import type { TolokaClient } from '../infra/toloka/client.ts'
import type { DockerClient } from '../infra/docker/client.ts'
import { parseLastSessionDone } from '../infra/docker/client.ts'
import type { Subscription } from '../domain/subscription.ts'
import type { AddIntakeStash } from '../infra/persistence/store.ts'
import { ownerAuth, type AppEnv } from './auth.ts'
import {
  serializeTask,
  serializeSearchResult,
  serializeSubscription,
  serializeShowSearchResult,
  serializeShowDetail,
  serializeCpu,
  serializeMemory,
  serializeVolumes,
  serializeDisks,
  serializeProcesses,
} from './serializers.ts'
import type { MyShowsShowDetailed, MyShowsSearchResult } from '../infra/myshows/client.ts'
import { refreshSubscriptionMetadata } from '../domain/subscription-metadata-refresh.ts'

/** Narrow slice of PersistentStore the subscriptions endpoints need. */
export interface SubscriptionStore {
  listSubscriptions(): Subscription[]
  getSubscription(id: string): Subscription | undefined
  addSubscription(sub: Subscription): void
  removeSubscription(id: string): void
}

/** Narrow slice of PersistentStore the add-intake stash endpoint reads (#99, #120). */
export interface TorrentStashReader {
  getTorrentStash(token: string): AddIntakeStash | undefined
}

/** Narrow slice of PersistentStore the Mini App UI-state endpoints use (#4). */
export interface UiStateStore {
  getUiList(key: string): string[]
  setUiList(key: string, values: string[]): void
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
  getShowById: (showId: number) => Promise<MyShowsShowDetailed>
  /** Episodes airing today for a show; injected for testability. */
  getTodayEpisodes: (showId: number) => Promise<TodayEpisode[]>
  /** Search shows by query string; injected for testability. */
  searchShows: (query: string) => Promise<MyShowsSearchResult[]>
  /** Base URL of the Toloka tracker — used to route Toloka download URLs through an authenticated fetch. */
  tolokaBaseUrl: string
  botToken: string
  ownerId: number
  /** Max initData age in seconds; 0 disables the freshness check. */
  initDataMaxAgeSeconds?: number
  /** Reader for .torrent files stashed by the bot (#99); absent in tests that don't exercise it. */
  torrentStash?: TorrentStashReader
  /** Server-side store for Mini App UI lists — search history, folder recents (#4). */
  uiState?: UiStateStore
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

/**
 * Host a .torrent's bytes at a public URL so DownloadStation can fetch it itself.
 *
 * This is the crux of the reliable add path (and what the original bot did): we
 * DON'T upload the bytes to DSM — its DSM-7 multipart create makes empty
 * `total_pieces:0` tasks. Instead we send the .torrent to Telegram via the Bot
 * API (it accepts a normal multipart) and hand DSM the resulting public
 * `api.telegram.org/file/bot…` URL via `createDownloadTaskFromUrl`. Telegram is
 * reachable by DSM without a Cloudflare bot-challenge (unlike our own tunnel),
 * which is why this is the dependable host. The document is sent silently to the
 * owner's chat; the file URL stays valid long enough for DSM to pull it.
 */
async function hostTorrentOnTelegram(
  botToken: string,
  chatId: number,
  bytes: Uint8Array,
  fileName: string,
): Promise<string> {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('disable_notification', 'true')
  form.append('document', new Blob([bytes], { type: 'application/x-bittorrent' }), fileName)
  const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form })
  const sendJson = (await sendRes.json()) as { ok: boolean; description?: string; result?: { document?: { file_id?: string } } }
  const fileId = sendJson.result?.document?.file_id
  if (!sendJson.ok || !fileId) {
    throw new Error(`Telegram sendDocument failed: ${sendJson.description ?? 'no file_id in response'}`)
  }
  const getRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`)
  const getJson = (await getRes.json()) as { ok: boolean; description?: string; result?: { file_path?: string } }
  const filePath = getJson.result?.file_path
  if (!getJson.ok || !filePath) {
    throw new Error(`Telegram getFile failed: ${getJson.description ?? 'no file_path in response'}`)
  }
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`
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
  const { synology, toloka, docker, store, getShowById, getTodayEpisodes, searchShows, tolokaBaseUrl } = deps
  const app = new Hono<AppEnv>()

  /**
   * Add a whole-torrent task from raw .torrent bytes the reliable way: host the
   * file on Telegram, then have DownloadStation fetch that public URL itself
   * (DS2 `type:"url"`). Replaces the DSM-7 multipart upload, which created empty
   * tasks. Shared by the .torrent-file upload and the Toloka-search add.
   */
  async function addTorrentByBytes(c: Context<AppEnv>, bytes: Uint8Array, fileName: string, destination: string) {
    let torrentUrl: string
    try {
      torrentUrl = await hostTorrentOnTelegram(deps.botToken, deps.ownerId, bytes, fileName)
    } catch (err) {
      return c.json({ error: `Could not stage the .torrent for DownloadStation: ${errorMessage(err)}` }, 502)
    }
    const result = await synology.createDownloadTaskFromUrl(torrentUrl, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  }

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
      return addTorrentByBytes(c, bytes, file.name, destination)
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
      return addTorrentByBytes(c, bytes, `${title}.torrent`, destination)
    }

    // Magnets (and plain URLs DSM can fetch directly) need no hosting hop.
    const result = await synology.createDownloadTask(uri, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  // --- Tasks: inspect → commit (per-file selection, #123) ---
  //
  // Selective per-file BT download is a two-phase flow on DownloadStation2
  // (verified on the live NAS). `/inspect` creates the task in INSPECTING state
  // (create_list=true) and returns its `list_id` + the file list; the confirm
  // step shows the tree, the owner picks a subset, then `/commit` selects that
  // subset (BT.File) and starts the download (Complete). Backing out without a
  // commit must DELETE the inspect so no orphaned list lingers on the NAS.
  //
  // Inspect needs the .torrent BYTES (magnets have none locally, but DSM
  // resolves magnet metadata server-side — so a magnet URI is passed through to
  // createDownloadTask as a whole-torrent add; only .torrent/Toloka sources get
  // a file tree). Accepts the same source shapes as POST /api/tasks: a multipart
  // .torrent upload, or a JSON {uri,title,destination} where the uri is a Toloka
  // URL we fetch with auth.

  // Per-file selection (#123) was RETIRED: the add always grabs the whole
  // torrent via the reliable type:url path, and the inspect's `create_list=true`
  // upload was itself the source of stuck `total_pieces:0` tasks (and a second
  // Toloka fetch per add). We keep the endpoint so the client doesn't 404, but it
  // no longer touches the NAS or Toloka — it returns an empty preview, and the
  // confirm step shows the whole-torrent add. `/commit` + the inspect DELETE
  // below are now unreachable from the client and kept only for compatibility.
  app.post('/api/tasks/inspect', (c) => c.json({ listId: null, files: [] }, 200))

  app.post('/api/tasks/commit', async (c) => {
    const body = await c.req.json().catch(() => null)
    const listId = body?.listId
    const indices = body?.indices // the SELECTED (wanted) file indices
    const destination = body?.destination
    if (typeof listId !== 'string' || !listId) {
      return c.json({ error: 'listId is required' }, 400)
    }
    if (!Array.isArray(indices) || indices.length === 0 || !indices.every((n) => Number.isInteger(n))) {
      return c.json({ error: 'indices must be a non-empty array of integers' }, 400)
    }
    // The Polling `download` commit takes the destination + the selected indices.
    if (typeof destination !== 'string' || !destination) {
      return c.json({ error: 'destination is required' }, 400)
    }
    const result = await synology.commitTaskSubset(listId, indices, destination)
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true }, 201)
  })

  app.delete('/api/tasks/inspect/:listId', async (c) => {
    const result = await synology.cancelTaskList(c.req.param('listId'))
    if (!result.ok) return c.json({ error: result.reason }, 502)
    return c.json({ ok: true })
  })

  // --- Add-intake stash (#99, generalized #120): fetch what the bot stashed ---
  // A stash holds either a .torrent's BYTES (#99) or a magnet/URL string (#120).
  // For bytes the Mini App reconstructs a File and runs createTaskFromFile; for
  // a URI it runs the normal createTask URI path. Either way it resumes the
  // wizard at the folder step. Idempotent; the stash ages out by its own TTL.
  // Sits under the /api/* owner guard — the token is a fetch key, not a capability.

  app.get('/api/torrent-stash/:token', (c) => {
    const stash = deps.torrentStash?.getTorrentStash(c.req.param('token'))
    if (!stash) return c.json({ error: 'not found' }, 404)
    if (stash.kind === 'uri') {
      return c.json({ kind: 'uri', uri: stash.uri })
    }
    return c.json({
      kind: 'bytes',
      name: stash.fileName,
      base64: Buffer.from(stash.data).toString('base64'),
    })
  })

  // --- Mini App UI state (#4) ---
  // Owner UI lists (search history, folder recents) persisted server-side because
  // Telegram WebView localStorage is wiped between sessions/redeploys (esp. iOS),
  // so "recent searches" kept vanishing. Whitelisted keys only; short string arrays.
  const UI_STATE_KEYS = new Set(['search-history', 'folder-recents'])
  const UI_STATE_CAP = 50

  app.get('/api/ui-state/:key', (c) => {
    const key = c.req.param('key')
    if (!UI_STATE_KEYS.has(key)) return c.json({ error: 'unknown ui-state key' }, 404)
    return c.json({ values: deps.uiState?.getUiList(key) ?? [] })
  })

  app.put('/api/ui-state/:key', async (c) => {
    const key = c.req.param('key')
    if (!UI_STATE_KEYS.has(key)) return c.json({ error: 'unknown ui-state key' }, 404)
    const body = await c.req.json().catch(() => null)
    const values = body?.values
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      return c.json({ error: 'values must be an array of strings' }, 400)
    }
    deps.uiState?.setUiList(key, values.slice(0, UI_STATE_CAP))
    return c.json({ ok: true })
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
      // Surface the healthiest releases first: sort by seeders desc so dead
      // (0-seed) torrents sink to the bottom instead of hiding in Toloka's order.
      const sorted = [...results].sort((a, b) => b.seeders - a.seeders)
      return c.json({ results: sorted.map(serializeSearchResult) })
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

  // Background backfill: refresh poster + latestAiredEpisode for ALL subscriptions
  // from live myshows, so the list self-fills when the Shows tab opens instead of
  // waiting for the daily digest (ADR 0009's lazy backfill made first load look
  // half-empty for pre-existing subs). Reuses the same metadata-refresh path as
  // the detail-page self-heal; a per-show fetch failure keeps that show's values.
  app.post('/api/subscriptions/refresh', async (c) => {
    const refreshed = await refreshSubscriptionMetadata(
      store.listSubscriptions(),
      async (showId) => {
        const show = await getShowById(showId)
        return { poster: show.image, episodes: show.episodes }
      },
      new Date()
    )
    for (const sub of refreshed) store.addSubscription(sub)
    return c.json({ subscriptions: refreshed.map(serializeSubscription) })
  })

  // /api/subscriptions/today is retired (ADR 0009 — the in-app today block is removed).
  // The endpoint returns 404 to signal removal to any lingering clients.
  app.get('/api/subscriptions/today', (c) => c.json({ error: 'endpoint retired' }, 404))

  app.post('/api/subscriptions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const showId = Number(body?.showId)
    if (!Number.isInteger(showId)) {
      return c.json({ error: 'showId (integer) is required' }, 400)
    }
    const existing = store.getSubscription(String(showId))
    if (existing) return c.json({ subscription: serializeSubscription(existing) })

    let show: MyShowsShowDetailed
    try {
      show = await getShowById(showId)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
    const sub: Subscription = { id: String(showId), showId, title: show.title, poster: show.image }
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

  // --- Shows: search + detail (ADR 0009) ---

  app.get('/api/shows/search', async (c) => {
    const q = c.req.query('q')?.trim()
    if (!q) return c.json({ error: 'q is required' }, 400)
    try {
      const results = await searchShows(q)
      const subscribedIds = new Set(store.listSubscriptions().map((s) => s.showId))
      return c.json({ results: results.map((r) => serializeShowSearchResult(r, subscribedIds)) })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }
  })

  app.get('/api/shows/:id', async (c) => {
    const showId = Number(c.req.param('id'))
    if (!Number.isInteger(showId) || showId <= 0) {
      return c.json({ error: 'showId must be a positive integer' }, 400)
    }

    let show: MyShowsShowDetailed
    try {
      show = await getShowById(showId)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502)
    }

    const subscribedIds = new Set(store.listSubscriptions().map((s) => s.showId))

    // Self-heal: if the show is subscribed, stamp updated poster + latestAiredEpisode into the store.
    const existingSub = store.getSubscription(String(showId))
    if (existingSub) {
      try {
        const [refreshed] = await refreshSubscriptionMetadata([existingSub], async () => ({
          poster: show.image,
          episodes: show.episodes,
        }), new Date())
        if (refreshed) store.addSubscription(refreshed)
      } catch {
        // Non-fatal: self-heal failure should not block the detail response.
      }
    }

    return c.json(serializeShowDetail(show, subscribedIds, new Date()))
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
