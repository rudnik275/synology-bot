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
  /** Release year extracted from torrent name (#117) */
  year?: number
  /** Resolution / source / codec / HDR tokens extracted from torrent name (#117) */
  quality?: string[]
  /** Language codes extracted from torrent name (#117) */
  languages?: string[]
}

export interface SearchResultView {
  id: string
  /** Human-readable title with scene tokens stripped (#117) */
  title: string
  size: string
  seeders: number
  leechers: number
  downloadUrl: string
  category: string
  /** Release year extracted from torrent name (#117) */
  year?: number
  /** Resolution / source / codec / HDR tokens extracted from torrent name (#117) */
  quality?: string[]
  /** Language codes extracted from torrent name (#117) */
  languages?: string[]
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

/** One file in an inspected torrent (#123 per-file selection). */
export interface InspectFileView {
  index: number
  path: string
  size: number
}

/**
 * Handle for committing an inspected torrent. Either a deferred `inspectToken`
 * (instant-tree bytes path — DSM list is created at commit time so the tree shows
 * with no DSM wait) or a pre-created DSM `listId` (magnet poll path).
 */
export type CommitHandle = { inspectToken: string } | { listId: string }
