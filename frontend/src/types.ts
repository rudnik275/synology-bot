// Mirrors the frozen API contract (epic #58). Kept in sync with src/server/serializers.ts.

export interface TaskView {
  id: string
  title: string
  status: string
  sizeBytes: number
  downloadedBytes: number
  speedBytesPerSec: number
  pct: number
  destination: string | null
}

export interface SearchResultView {
  id: string
  title: string
  size: string
  seeders: number
  leechers: number
  downloadUrl: string
  category: string
}

export interface SubscriptionView {
  id: string
  showId: number
  title: string
  lastNotifiedEpisode: { season: number; episode: number } | null
  poster: string | null
  latestAiredEpisode: { season: number; episode: number; airDate: string } | null
}

/** Retired: /api/subscriptions/today is gone (ADR 0009). Kept for reference only. */
export interface TodayEpisodeView {
  showId: number
  title: string
  season: number
  episode: number
  airTime: string
}

// --- Shows tab (ADR 0009) ---

export interface ShowSearchResultView {
  id: number
  title: string
  titleOriginal: string | null
  poster: string | null
  isSubscribed: boolean
}

export interface ShowEpisodeView {
  episode: number
  title: string
  airDate: string | null
  aired: boolean
}

export interface ShowSeasonView {
  season: number
  episodes: ShowEpisodeView[]
}

export interface ShowDetailView {
  id: number
  title: string
  titleOriginal: string | null
  poster: string | null
  description: string | null
  isSubscribed: boolean
  seasons: ShowSeasonView[]
}

export interface HealthView {
  cpu: { userLoad: number; systemLoad: number } | null
  memory: { usedBytes: number; totalBytes: number; pct: number } | null
  volumes: Array<{ path: string; usedBytes: number; totalBytes: number; pct: number; status: string }> | null
  disks: Array<{ model: string; tempC: number; tempStatus: string; status: string; smart: string }> | null
  processes: {
    topRam: Array<{ name: string; bytes: number }>
    topCpu: Array<{ name: string; pct: number }>
  } | null
  errors: Array<{ section: string; reason: string }>
}

export interface FolderView {
  name: string
  path: string
}
