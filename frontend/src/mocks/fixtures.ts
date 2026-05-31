// DEV-ONLY mock fixtures + in-memory state for the Mini App API (see ./index.ts).
// Lets the design be viewed fully in `npm run dev` with no backend running.
// Values are picked to exercise every visual state: download statuses across the
// badge palette, a busiest volume in "warn" (loud orange hero), an elevated disk,
// a never-notified subscription, today-airing episodes, etc. Tweak freely — this
// file never ships (the whole ./mocks dir is gated behind import.meta.env.DEV).
import type {
  HealthView,
  TaskView,
  SubscriptionView,
  TodayEpisodeView,
  SearchResultView,
  FolderView,
} from '../types'

const MB = 1024 ** 2
const GB = 1024 ** 3

// ── Downloads ───────────────────────────────────────────────────────────────
// Mutable: pause/resume/delete/create mutate this; GET /tasks "ticks" progress.
export const tasks: TaskView[] = [
  { id: 't1', title: 'Ubuntu 24.04.1 LTS Desktop (amd64).iso', status: 'downloading', sizeBytes: 5.8 * GB, downloadedBytes: 2.4 * GB, speedBytesPerSec: 11.6 * MB, pct: 42, destination: '/volume1/downloads' },
  { id: 't2', title: 'Planet Earth III — S01 COMPLETE 2160p HDR', status: 'downloading', sizeBytes: 64 * GB, downloadedBytes: 50 * GB, speedBytesPerSec: 6.2 * MB, pct: 78, destination: '/volume1/media/Documentaries' },
  { id: 't3', title: 'The Bear — S03E01 1080p WEB-DL', status: 'finishing', sizeBytes: 2.1 * GB, downloadedBytes: 2.08 * GB, speedBytesPerSec: 1.2 * MB, pct: 99, destination: '/volume1/media/Shows' },
  { id: 't4', title: 'Dune: Part Two (2024) 2160p HDR x265', status: 'paused', sizeBytes: 28 * GB, downloadedBytes: 4.2 * GB, speedBytesPerSec: 0, pct: 15, destination: '/volume1/media/Movies' },
  { id: 't5', title: 'debian-12.7.0-amd64-netinst.iso', status: 'waiting', sizeBytes: 0.7 * GB, downloadedBytes: 0, speedBytesPerSec: 0, pct: 0, destination: '/volume1/downloads' },
  { id: 't6', title: 'Severance — S02 COMPLETE 1080p', status: 'seeding', sizeBytes: 18 * GB, downloadedBytes: 18 * GB, speedBytesPerSec: 0, pct: 100, destination: '/volume1/media/Shows' },
  { id: 't7', title: 'corrupted-tracker-payload.torrent', status: 'error', sizeBytes: 0, downloadedBytes: 0, speedBytesPerSec: 0, pct: 0, destination: '/volume1/downloads' },
]

// ── NAS health ────────────────────────────────────────────────────────────
// Base snapshot; ./index.ts applies a little jitter per poll so the "live" dot
// and numbers actually move. Busiest volume sits at 84% → warn → orange hero.
export const baseHealth: HealthView = {
  cpu: { userLoad: 23, systemLoad: 7 },
  memory: { usedBytes: 5.1 * GB, totalBytes: 8 * GB, pct: 64 },
  volumes: [
    { path: '/volume1', usedBytes: 6.7 * 1000 * GB, totalBytes: 8 * 1000 * GB, pct: 84, status: 'normal' },
    { path: '/volume2', usedBytes: 1.8 * 1000 * GB, totalBytes: 4 * 1000 * GB, pct: 46, status: 'normal' },
  ],
  disks: [
    { model: 'WD Red Plus 8TB', tempC: 39, tempStatus: 'normal', status: 'normal', smart: 'normal' },
    { model: 'Seagate IronWolf 8TB', tempC: 47, tempStatus: 'elevated', status: 'normal', smart: 'normal' },
    { model: 'WD Red 4TB', tempC: 41, tempStatus: 'normal', status: 'normal', smart: 'normal' },
  ],
  processes: {
    topCpu: [
      { name: 'synoindexd', pct: 14.2 },
      { name: 'dockerd', pct: 8.6 },
      { name: 'Plex Media Server', pct: 6.1 },
      { name: 'smbd', pct: 2.3 },
    ],
    topRam: [
      { name: 'Plex Media Server', bytes: 1.8 * GB },
      { name: 'dockerd', bytes: 920 * MB },
      { name: 'synoindexd', bytes: 540 * MB },
    ],
  },
  errors: [],
}

// ── Shows: subscriptions + today ──────────────────────────────────────────
// Mutable: subscribe/unsubscribe mutate this list.
export const subscriptions: SubscriptionView[] = [
  { id: 's1', showId: 1396, title: 'Breaking Bad', lastNotifiedEpisode: { season: 5, episode: 16 } },
  { id: 's2', showId: 1399, title: 'Game of Thrones', lastNotifiedEpisode: { season: 8, episode: 6 } },
  { id: 's3', showId: 60625, title: 'Rick and Morty', lastNotifiedEpisode: null },
]

export const todayEpisodes: TodayEpisodeView[] = [
  { showId: 12345, title: 'The Bear', season: 3, episode: 5, airTime: '18:00' },
  { showId: 95396, title: 'Severance', season: 2, episode: 3, airTime: '21:30' },
]

// A tiny showId → name table so a freshly-added subscription gets a real-looking
// title instead of a bare number; unknown ids fall back to "Show #<id>".
const SHOW_NAMES: Record<number, string> = {
  1396: 'Breaking Bad',
  1399: 'Game of Thrones',
  60625: 'Rick and Morty',
  1668: 'Friends',
  82856: 'The Mandalorian',
  95396: 'Severance',
  12345: 'The Bear',
}

export function showTitle(showId: number): string {
  return SHOW_NAMES[showId] ?? `Show #${showId}`
}

// ── Search (AddFlow search step) ──────────────────────────────────────────
export function searchResults(query: string | null): SearchResultView[] {
  const q = (query ?? '').trim() || 'linux'
  const variants: Array<{ res: string; src: string; cat: string }> = [
    { res: '2160p', src: 'BluRay REMUX', cat: 'Movies' },
    { res: '1080p', src: 'WEB-DL', cat: 'TV' },
    { res: '1080p', src: 'BluRay x265', cat: 'Movies' },
    { res: '720p', src: 'HDTV', cat: 'TV' },
  ]
  return variants.map((v, i) => ({
    id: `r${i}`,
    title: `${q} ${v.res} ${v.src}`,
    size: `${(1.5 + i * 2.3).toFixed(1)} GB`,
    seeders: 240 - i * 55,
    leechers: 18 - i * 4,
    downloadUrl: `magnet:?xt=urn:btih:mock${i}&dn=${encodeURIComponent(`${q} ${v.res}`)}`,
    category: v.cat,
  }))
}

// ── Folders (destination picker) ──────────────────────────────────────────
const FOLDER_TREE: Record<string, FolderView[]> = {
  '': [
    { name: 'volume1', path: '/volume1' },
    { name: 'volume2', path: '/volume2' },
  ],
  '/volume1': [
    { name: 'downloads', path: '/volume1/downloads' },
    { name: 'media', path: '/volume1/media' },
    { name: 'docs', path: '/volume1/docs' },
  ],
  '/volume1/media': [
    { name: 'Movies', path: '/volume1/media/Movies' },
    { name: 'Shows', path: '/volume1/media/Shows' },
    { name: 'Documentaries', path: '/volume1/media/Documentaries' },
  ],
  '/volume2': [{ name: 'backups', path: '/volume2/backups' }],
}

export function folders(path: string | null): FolderView[] {
  return FOLDER_TREE[path ?? ''] ?? []
}

// ── Torrent stash (#99 deep-link recovery) ─────────────────────────────────
// A real (empty) .torrent is unnecessary — any base64 lets the wizard rebuild a
// File and render the confirm step. btoa is browser-native.
export function stash(_token: string): { name: string; base64: string } {
  return { name: 'forwarded-by-bot.torrent', base64: btoa('d8:announce0:e') }
}
