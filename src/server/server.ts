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
import { parseTorrentFiles } from '../infra/torrent/bencode.ts'
import { tryResult } from '../lib/result.ts'
import { respondResult, requireString, requireIntArray } from './respond.ts'

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
  /**
   * Public base URL of this Mini App server (e.g. `https://nas.rudifamily.uk`).
   * Used to build the short-lived `/torrent-file/<token>.torrent` URL that
   * DownloadStation fetches when we add a .torrent we hold as bytes (Toloka /
   * uploaded file) — DSM downloads + parses it itself via the documented
   * `SYNO.DownloadStation.Task` `create` `uri`. Verified live: DSM reaches this
   * host through the Cloudflare tunnel with no bot-challenge.
   */
  miniappUrl: string
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
  const { synology, toloka, docker, store, getShowById, getTodayEpisodes, searchShows, tolokaBaseUrl, miniappUrl } = deps
  const app = new Hono<AppEnv>()

  // Short-lived store of .torrent bytes we hand to DownloadStation by URL. DSM
  // cannot fetch the original source (an authenticated Toloka download, or bytes
  // uploaded from the Mini App), so we stash the bytes here under an unguessable
  // token and let DSM pull them from `/torrent-file/<token>.torrent` (an open
  // route below — DSM can't send Telegram initData). The token is single-use-ish
  // and expires; the bytes only need to live the few seconds until DSM fetches.
  const SERVE_TTL_MS = 15 * 60 * 1000
  const servedTorrents = new Map<string, { bytes: Uint8Array; expiresAt: number }>()
  function stashServedTorrent(bytes: Uint8Array): string {
    const now = Date.now()
    for (const [k, v] of servedTorrents) if (v.expiresAt <= now) servedTorrents.delete(k)
    const token = crypto.randomUUID().replace(/-/g, '')
    servedTorrents.set(token, { bytes, expiresAt: now + SERVE_TTL_MS })
    return token
  }

  /** The open URL DSM fetches a stashed .torrent from, for a given stash token. */
  function torrentFileUrl(token: string): string | null {
    return miniappUrl ? `${miniappUrl.replace(/\/$/, '')}/torrent-file/${token}.torrent` : null
  }

  /**
   * Stash raw .torrent bytes and return both the stash `token` and a URL
   * DownloadStation can fetch ITSELF (DSM can't pull an authenticated Toloka link
   * or Mini-App upload). Verified live: DSM downloads + parses a .torrent served
   * from this host through the Cloudflare tunnel. The `token` lets a DEFERRED
   * inspect commit re-derive the URL later (instant tree, see POST /tasks/inspect).
   * Returns null when MINIAPP_URL is unconfigured.
   */
  function servedUrlForBytes(bytes: Uint8Array): { url: string; token: string } | null {
    if (!miniappUrl) return null
    const token = stashServedTorrent(bytes)
    const url = torrentFileUrl(token)
    return url ? { url, token } : null
  }

  /** Re-derive a still-live stash's URL by token (for the deferred inspect commit).
   *  Returns null if MINIAPP_URL is unset or the token is unknown/expired. */
  function servedUrlForToken(token: string): string | null {
    const entry = servedTorrents.get(token)
    if (!entry || entry.expiresAt <= Date.now()) return null
    return torrentFileUrl(token)
  }

  /**
   * Resolve an add request (whole-torrent or inspect) to a single URL DSM can
   * fetch + the destination. Handles all three sources: a multipart `.torrent`
   * upload and an authenticated Toloka link are downloaded → self-hosted; a
   * magnet / plain `.torrent` URL is handed through as-is. Shared by the
   * whole-torrent add and the per-file inspect so they branch identically.
   *
   * `bytes` carries the raw .torrent when we HAVE it locally (multipart upload or
   * a Toloka download) so inspect can parse the file tree itself and skip the
   * DSM metadata poll (#161). A magnet / plain URL has no local bytes → undefined.
   */
  async function resolveSource(
    c: Context<AppEnv>
  ): Promise<
    | { ok: true; url: string; destination: string; bytes?: Uint8Array; token?: string }
    | { ok: false; status: 400 | 502; error: string }
  > {
    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody().catch(() => null)
      const file = body?.['file']
      const destination = body?.['destination']
      if (!(file instanceof File) || typeof destination !== 'string' || !destination) {
        return { ok: false, status: 400, error: 'file and destination are required' }
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const served = servedUrlForBytes(bytes)
      if (!served) return { ok: false, status: 502, error: 'MINIAPP_URL is not configured' }
      return { ok: true, url: served.url, destination, bytes, token: served.token }
    }

    const body = await c.req.json().catch(() => null)
    const uri = body?.uri
    const destination = body?.destination
    if (typeof uri !== 'string' || !uri || typeof destination !== 'string' || !destination) {
      return { ok: false, status: 400, error: 'uri and destination are required' }
    }

    if (!uri.startsWith('magnet:') && isTolokaUrl(uri, tolokaBaseUrl)) {
      const downloaded = await tryResult(() => toloka.downloadTorrent(uri))
      if (!downloaded.ok) return { ok: false, status: 502, error: downloaded.reason }
      const served = servedUrlForBytes(downloaded.data)
      if (!served) return { ok: false, status: 502, error: 'MINIAPP_URL is not configured' }
      return { ok: true, url: served.url, destination, bytes: downloaded.data, token: served.token }
    }

    // Magnets and plain URLs DSM can fetch directly — no hosting hop, no bytes.
    return { ok: true, url: uri, destination }
  }

  app.get('/healthz', (c) => c.json({ ok: true }))

  // Open route (NO initData auth — DownloadStation can't sign initData): serves a
  // stashed .torrent's raw bytes so DSM can fetch it by `uri`. Token-gated +
  // short TTL; the path ends in `.torrent` so DSM treats the response as a torrent.
  app.get('/torrent-file/:file', (c) => {
    const token = c.req.param('file').replace(/\.torrent$/i, '')
    const entry = servedTorrents.get(token)
    if (!entry || entry.expiresAt <= Date.now()) {
      servedTorrents.delete(token)
      return c.json({ error: 'not found' }, 404)
    }
    return c.body(new Uint8Array(entry.bytes), 200, {
      'Content-Type': 'application/x-bittorrent',
      'Content-Disposition': `attachment; filename="${token}.torrent"`,
    })
  })

  app.use(
    '/api/*',
    ownerAuth({ botToken: deps.botToken, ownerId: deps.ownerId, maxAgeSeconds: deps.initDataMaxAgeSeconds })
  )

  // --- Tasks: read ---

  app.get('/api/tasks', async (c) => {
    const result = await synology.listTasks()
    if (!result.ok) return respondResult(c, result)
    return c.json({ tasks: result.data.map(serializeTask) })
  })

  // --- Tasks: actions ---

  app.post('/api/tasks/:id/pause', async (c) => {
    const result = await synology.pauseTask(c.req.param('id'))
    return respondResult(c, result)
  })

  app.post('/api/tasks/:id/resume', async (c) => {
    const result = await synology.resumeTask(c.req.param('id'))
    return respondResult(c, result)
  })

  app.delete('/api/tasks/:id', async (c) => {
    const deleteFiles = c.req.query('deleteFiles') === 'true'
    const result = await synology.deleteTask(c.req.param('id'), deleteFiles)
    return respondResult(c, result)
  })

  // --- Tasks: create whole torrent (unified, per #58) ---
  // Accepts either JSON {uri,destination} (magnet or URL) or a multipart
  // {file,destination} (.torrent upload). Toloka URLs are fetched with auth;
  // magnets and plain URLs are handed straight to DownloadStation.

  app.post('/api/tasks', async (c) => {
    const src = await resolveSource(c)
    if (!src.ok) return c.json({ error: src.error }, src.status)
    const result = await synology.createDownloadTask(src.url, src.destination)
    return respondResult(c, result, { okStatus: 201 })
  })

  // --- Per-file selection (#123): inspect → (client picks files) → commit ---
  // DS2 `create_list:true` parses the torrent into a transient `list_id` we read
  // the file tree from, then `Task.List download` commits the chosen subset.
  // Start an inspect so the owner can pick files. Two source shapes:
  //
  // • BYTES we hold (multipart upload / Toloka download): parse the file tree
  //   LOCALLY (bencode, ~1ms) and return it INSTANTLY with an `inspectToken` —
  //   WITHOUT touching DSM. createInspectList (the multi-second DSM round-trip)
  //   is DEFERRED to the optimistic commit (POST /tasks/commit), which already
  //   runs in the background after «Добавить». So the tree appears with no DSM
  //   wait, and the owner never blocks on DSM. The bytes stay in the served stash
  //   (15-min TTL) so the deferred create can self-host them; the local index ==
  //   DSM's index because both enumerate the .torrent's fixed `info.files` order
  //   (parity covered by bencode.test.ts), so `selected` stays correct at commit.
  //   Bonus: no DSM list is created here → backing out of Confirm leaves no orphan.
  //
  // • Magnets (no local bytes): we can't parse them, so create the list NOW and
  //   return `{listId}`; the client polls GET /tasks/inspect/:id for the tree DSM
  //   fetches from peers, then commits by listId (unchanged two-call path).
  app.post('/api/tasks/inspect', async (c) => {
    const src = await resolveSource(c)
    if (!src.ok) return c.json({ error: src.error }, src.status)
    if (src.bytes && src.token) {
      try {
        const files = parseTorrentFiles(src.bytes).map((f, index) => ({ index, name: f.path, size: f.length }))
        if (files.length > 0) return c.json({ inspectToken: src.token, files }, 201)
        console.warn(`[inspect] local parse yielded 0 files (${src.bytes.length}B) — falling back to DSM create+poll`)
      } catch (err) {
        // A parse error must NEVER break inspect — fall through to the DSM path.
        // Log it: a silent fall-through hides the instant tree never appearing.
        console.warn(`[inspect] local bencode parse failed (${src.bytes.length}B), falling back to DSM create+poll: ${errorMessage(err)}`)
      }
    }
    // Magnet (no local bytes) or local parse failed: create the DSM list now so the
    // client can poll for the parsed tree and commit by listId.
    const result = await synology.createInspectList(src.url, src.destination)
    if (!result.ok) return respondResult(c, result)
    return c.json({ listId: result.listId }, 201)
  })

  // Poll a started inspect for its file tree. `ready` flips true once DSM has
  // parsed the torrent's metadata (the client polls until then).
  app.get('/api/tasks/inspect/:listId', async (c) => {
    const result = await synology.getInspectList(c.req.param('listId'))
    if (!result.ok) return respondResult(c, result)
    const files = result.data.files ?? []
    return c.json({
      ready: files.length > 0,
      title: result.data.title ?? '',
      size: result.data.size ?? 0,
      files: files.map((f) => ({ index: f.index, name: f.name, size: f.size })),
    })
  })

  // Abandon an inspect the user cancelled (best-effort).
  app.delete('/api/tasks/inspect/:listId', async (c) => {
    const result = await synology.deleteInspectList(c.req.param('listId'))
    return respondResult(c, result)
  })

  // Commit the chosen files (`selected` = indices to KEEP) into a real task.
  // Two handles, mirroring inspect:
  //   • `inspectToken` (instant-tree path): DSM was never touched at inspect time,
  //     so create the list NOW from the still-stashed bytes — this multi-second DSM
  //     round-trip lives HERE, in the optimistic background — then commit it.
  //   • `listId` (magnet path): the list was already created at inspect time; just
  //     commit it.
  app.post('/api/tasks/commit', async (c) => {
    const body = await c.req.json().catch(() => null)
    const listId = body?.listId
    const inspectToken = body?.inspectToken
    const destGuard = requireString(body, 'destination')
    if (!destGuard.ok) return c.json({ error: destGuard.error }, 400)
    const destination = destGuard.value
    const selectedGuard = requireIntArray(body, 'selected')
    if (!selectedGuard.ok) return c.json({ error: selectedGuard.error }, 400)
    const selected = selectedGuard.value
    let listIdToCommit: string
    // Track lists we create HERE (the deferred token path) so a failed commit can
    // release them — the client never saw this listId and can't clean it up.
    let createdFromToken = false
    if (typeof inspectToken === 'string' && inspectToken) {
      const url = servedUrlForToken(inspectToken)
      if (!url) return c.json({ error: 'inspect expired — reopen the torrent' }, 410)
      const created = await synology.createInspectList(url, destination)
      if (!created.ok) return respondResult(c, created)
      listIdToCommit = created.listId
      createdFromToken = true
    } else if (typeof listId === 'string' && listId) {
      listIdToCommit = listId
    } else {
      return c.json({ error: 'listId or inspectToken is required' }, 400)
    }
    const result = await synology.commitInspectList(listIdToCommit, selected, destination)
    if (!result.ok) {
      // Deferred path just created this transient list; release it so a failed
      // commit doesn't orphan it on the NAS (best-effort — ignore the result).
      if (createdFromToken) void synology.deleteInspectList(listIdToCommit)
      return respondResult(c, result)
    }
    return c.json({ ok: true }, 201)
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
    const values = (body as Record<string, unknown> | null)?.values
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
    if (!result.ok) return respondResult(c, result)
    return c.json({ folders: result.data })
  })

  // --- Toloka search ---

  app.get('/api/search', async (c) => {
    const q = c.req.query('q')?.trim()
    if (!q) return c.json({ error: 'q is required' }, 400)
    const r = await tryResult(() => toloka.search(q))
    if (!r.ok) return respondResult(c, r)
    // Surface the healthiest releases first: sort by seeders desc so dead
    // (0-seed) torrents sink to the bottom instead of hiding in Toloka's order.
    const sorted = [...r.data].sort((a, b) => b.seeders - a.seeders)
    return c.json({ results: sorted.map(serializeSearchResult) })
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

    const r = await tryResult(() => getShowById(showId))
    if (!r.ok) return respondResult(c, r)
    const show = r.data
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
    const r = await tryResult(() => searchShows(q))
    if (!r.ok) return respondResult(c, r)
    const subscribedIds = new Set(store.listSubscriptions().map((s) => s.showId))
    return c.json({ results: r.data.map((s) => serializeShowSearchResult(s, subscribedIds)) })
  })

  app.get('/api/shows/:id', async (c) => {
    const showId = Number(c.req.param('id'))
    if (!Number.isInteger(showId) || showId <= 0) {
      return c.json({ error: 'showId must be a positive integer' }, 400)
    }

    const r = await tryResult(() => getShowById(showId))
    if (!r.ok) return respondResult(c, r)
    const show = r.data

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
    const r = await tryResult(() => docker.getContainerByName('watchtower'))
    if (!r.ok) return respondResult(c, r)
    const container = r.data
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
