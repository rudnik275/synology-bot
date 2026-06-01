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
  cpu: { userLoad: 31, systemLoad: 9 },
  memory: { usedBytes: 9.8 * GB, totalBytes: 16 * GB, pct: 61 },
  volumes: [
    // busiest → hero: 84% = warn (orange). Plus an ok and a near-empty one so
    // the secondary-bar list has range. Bump volume1 ≥90 to preview the red hero.
    { path: '/volume1', usedBytes: 6.7 * 1000 * GB, totalBytes: 8 * 1000 * GB, pct: 84, status: 'normal' },
    { path: '/volume2', usedBytes: 2.7 * 1000 * GB, totalBytes: 4 * 1000 * GB, pct: 67, status: 'normal' },
    { path: '/volume3', usedBytes: 4.9 * 1000 * GB, totalBytes: 12 * 1000 * GB, pct: 41, status: 'normal' },
  ],
  disks: [
    // Exercises the full severity triad: ok (green) / elevated → warn (orange) /
    // failing SMART → bad (red).
    { model: 'WD Red Plus 8TB', tempC: 38, tempStatus: 'normal', status: 'normal', smart: 'normal' },
    { model: 'WD Red Plus 8TB', tempC: 40, tempStatus: 'normal', status: 'normal', smart: 'normal' },
    { model: 'Seagate IronWolf 8TB', tempC: 47, tempStatus: 'elevated', status: 'normal', smart: 'normal' },
    { model: 'Seagate IronWolf 8TB', tempC: 44, tempStatus: 'normal', status: 'normal', smart: 'normal' },
    { model: 'WD Red 4TB', tempC: 53, tempStatus: 'elevated', status: 'normal', smart: 'failing' },
  ],
  processes: {
    topCpu: [
      { name: 'synoindexd', pct: 22.4 },
      { name: 'dockerd', pct: 11.3 },
      { name: 'Plex Media Server', pct: 8.7 },
      { name: 'ffmpeg', pct: 5.2 },
      { name: 'smbd', pct: 2.1 },
    ],
    topRam: [
      { name: 'Plex Media Server', bytes: 2.1 * GB },
      { name: 'dockerd', bytes: 1.1 * GB },
      { name: 'synoindexd', bytes: 640 * MB },
      { name: 'postgres', bytes: 480 * MB },
    ],
  },
  errors: [],
}

// ── Shows: subscriptions ─────────────────────────────────────────────────
// Mutable: subscribe/unsubscribe mutate this list.
// poster is null here since the mock doesn't serve real images; latestAiredEpisode
// is the new badge field (ADR 0009) — populated with realistic data.
export const subscriptions: SubscriptionView[] = [
  { id: 's1', showId: 1396, title: 'Breaking Bad', lastNotifiedEpisode: { season: 5, episode: 16 }, poster: null, latestAiredEpisode: { season: 5, episode: 16, airDate: '2013-09-29T02:00:00Z' } },
  { id: 's2', showId: 1399, title: 'Game of Thrones', lastNotifiedEpisode: { season: 8, episode: 6 }, poster: null, latestAiredEpisode: { season: 8, episode: 6, airDate: '2019-05-19T02:00:00Z' } },
  { id: 's3', showId: 60625, title: 'Rick and Morty', lastNotifiedEpisode: null, poster: null, latestAiredEpisode: null },
  { id: 's4', showId: 82856, title: 'The Mandalorian', lastNotifiedEpisode: { season: 3, episode: 8 }, poster: null, latestAiredEpisode: { season: 3, episode: 8, airDate: '2023-04-19T04:00:00Z' } },
  { id: 's5', showId: 95396, title: 'Severance', lastNotifiedEpisode: { season: 2, episode: 3 }, poster: null, latestAiredEpisode: { season: 2, episode: 3, airDate: '2025-02-21T12:00:00Z' } },
  { id: 's6', showId: 100088, title: 'The Last of Us', lastNotifiedEpisode: { season: 1, episode: 9 }, poster: null, latestAiredEpisode: { season: 1, episode: 9, airDate: '2023-03-12T02:00:00Z' } },
  { id: 's7', showId: 93740, title: 'Foundation', lastNotifiedEpisode: null, poster: null, latestAiredEpisode: null },
  { id: 's8', showId: 125988, title: 'Silo', lastNotifiedEpisode: { season: 1, episode: 10 }, poster: null, latestAiredEpisode: { season: 1, episode: 10, airDate: '2023-07-28T00:00:00Z' } },
  { id: 's9', showId: 153312, title: 'Fallout', lastNotifiedEpisode: null, poster: null, latestAiredEpisode: null },
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
  136315: 'The Bear',
  100088: 'The Last of Us',
  93740: 'Foundation',
  125988: 'Silo',
  153312: 'Fallout',
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
