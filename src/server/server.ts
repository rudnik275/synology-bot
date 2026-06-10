import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import type { SynologyClient } from '../infra/synology/client.ts'
import type { TolokaClient } from '../infra/toloka/client.ts'
import type { DockerClient } from '../infra/docker/client.ts'
import type { Subscription } from '../domain/subscription.ts'
import type { AddIntakeStash } from '../infra/persistence/store.ts'
import { ownerAuth, type AppEnv } from './auth.ts'
import { serializeSearchResult } from './serializers.ts'
import type { MyShowsShowDetailed, MyShowsSearchResult } from '../infra/myshows/client.ts'
import { tryResult } from '../lib/result.ts'
import { respondResult } from './respond.ts'
import {
  createTorrentStash,
  registerTaskRoutes,
  registerTorrentFileRoute,
} from './routes/registerTaskRoutes.ts'
import { registerFolderRoutes } from './routes/registerFolderRoutes.ts'
import { registerHealthRoute } from './routes/registerHealthRoute.ts'
import { registerSubscriptionRoutes } from './routes/registerSubscriptionRoutes.ts'
import { registerShowRoutes } from './routes/registerShowRoutes.ts'
import { registerDeployStatusRoute } from './routes/registerDeployStatusRoute.ts'
import { registerTorrentStashRoute } from './routes/registerTorrentStashRoute.ts'
import { registerUiStateRoutes } from './routes/registerUiStateRoutes.ts'
import { registerSettingsRoutes } from './routes/registerSettingsRoutes.ts'
import type { SettingsProvider } from '../domain/settings.ts'

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
  /**
   * Clears a notif-dedup row (event: 'failed' | 'stuck') so a resumed task can
   * re-alert if it errors or sticks again (#301).
   */
  clearNotifFired: (taskId: string, event: string) => void
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
  /** Runtime-tunable settings provider (#305); absent in tests that don't exercise it. */
  settings?: SettingsProvider
  /**
   * Filesystem root of the built Vue SPA (Vite `dist`), resolved relative to
   * the process CWD. The API and /healthz are registered first and win; any
   * other path falls back to index.html for client-side routing. Defaults to
   * the production layout; tests point it at a fixture.
   */
  staticRoot?: string
}

/**
 * The Mini App backend (ADR 0005). A JSON API over the existing infra layer,
 * meant to run on loopback behind a Cloudflare Tunnel. Everything under /api
 * is gated by owner-signed Telegram initData; /healthz is an open liveness probe.
 *
 * Responses follow the frozen contract of epic #58 (normalized shapes, not raw
 * DSM/Toloka JSON) — serialization lives in ./serializers.ts. Upstream
 * (NAS / Toloka) failures map to 502; bad client input maps to 400.
 *
 * createServer is now assembly: auth middleware + register* calls + static SPA.
 * Route implementations live in src/server/routes/register*.ts.
 */
export function createServer(deps: ServerDeps): Hono<AppEnv> {
  const { synology, toloka, docker, store, getShowById, searchShows, tolokaBaseUrl, miniappUrl, clearNotifFired } = deps
  const app = new Hono<AppEnv>()

  // Short-lived in-memory stash of .torrent bytes DSM fetches by URL.
  // Shared between the open /torrent-file/:file route and the task routes
  // (add, inspect, commit). Must live here so both open+auth routes share it.
  const stash = createTorrentStash(miniappUrl)

  // ── Open routes (no auth — before the /api/* middleware) ──────────────────

  app.get('/healthz', (c) => c.json({ ok: true }))

  registerTorrentFileRoute(app, stash)

  // ── Auth middleware for all /api/* routes ─────────────────────────────────

  app.use(
    '/api/*',
    ownerAuth({ botToken: deps.botToken, ownerId: deps.ownerId, maxAgeSeconds: deps.initDataMaxAgeSeconds })
  )

  // ── Toloka search (inline — not enough routes to justify its own module) ──

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

  // ── Per-domain route registrars ────────────────────────────────────────────

  registerTaskRoutes(app, { synology, toloka, tolokaBaseUrl, miniappUrl, clearNotifFired }, stash)
  registerFolderRoutes(app, { synology })
  registerHealthRoute(app, { synology })
  registerSubscriptionRoutes(app, { store, getShowById })
  registerShowRoutes(app, { store, getShowById, searchShows })
  registerDeployStatusRoute(app, { docker })
  registerTorrentStashRoute(app, { torrentStash: deps.torrentStash })
  registerUiStateRoutes(app, { uiState: deps.uiState })
  registerSettingsRoutes(app, { settings: deps.settings })

  // Unknown /api paths get a JSON 404 instead of falling through to the SPA
  // index.html (which clients would choke on when parsing as JSON).
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  // ── Static SPA (Phase 3) ──────────────────────────────────────────────────
  // Registered last so /api and /healthz keep priority. Built assets are
  // served from `staticRoot`; every other (non-API) path falls back to
  // index.html for client-side routing.
  const staticRoot = deps.staticRoot ?? './frontend/dist'
  app.use('/assets/*', serveStatic({ root: staticRoot }))
  app.get('*', serveStatic({ path: `${staticRoot}/index.html` }))

  return app
}
