import type {
  Task,
  SystemUtilization,
  StorageInfo,
  DiskInfo,
  ProcessGroupSlice,
} from '../infra/synology/types.ts'
import type { TolokaResult } from '../infra/toloka/types.ts'
import type { Subscription } from '../domain/subscription.ts'
import { cleanReleaseTitle } from '../domain/clean-release-title.ts'
import type { MyShowsSearchResult, MyShowsShowDetailed } from '../infra/myshows/client.ts'

/**
 * Pure serializers mapping infra/domain types to the frozen Mini App API
 * contract (epic #58). The frontend depends on these stable shapes, not on
 * raw DSM/Toloka field names — so all field renaming and unit conversion
 * lives here, isolated and unit-tested.
 */

// --- Tasks ---

export interface TaskView {
  id: string
  /** Human-readable title with scene tokens stripped (#117) */
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

export function serializeTask(t: Task): TaskView {
  const sizeBytes = t.size ?? 0
  const downloadedBytes = t.additional?.transfer?.size_downloaded ?? 0
  const speedBytesPerSec = t.additional?.transfer?.speed_download ?? 0
  const pct = sizeBytes > 0 ? Math.min(100, Math.round((downloadedBytes / sizeBytes) * 100)) : 0
  const cleaned = cleanReleaseTitle(t.title)
  return {
    id: t.id,
    title: cleaned.title,
    status: t.status,
    sizeBytes,
    downloadedBytes,
    speedBytesPerSec,
    pct,
    destination: t.additional?.detail?.destination ?? null,
    ...(cleaned.year !== undefined && { year: cleaned.year }),
    ...(cleaned.quality.length > 0 && { quality: cleaned.quality }),
    ...(cleaned.languages.length > 0 && { languages: cleaned.languages }),
  }
}

// --- Search ---

export interface SearchResultView {
  id: string
  /** Human-readable title with scene tokens stripped (#117) */
  title: string
  size: string
  seeders: number
  leechers: number
  /** Absolute URL to the .torrent. (Toloka yields no magnets — the #58 `magnet?` field was wrong.) */
  downloadUrl: string
  category: string
  /** Release year extracted from torrent name (#117) */
  year?: number
  /** Resolution / source / codec / HDR tokens extracted from torrent name (#117) */
  quality?: string[]
  /** Language codes extracted from torrent name (#117) */
  languages?: string[]
}

export function serializeSearchResult(r: TolokaResult): SearchResultView {
  const cleaned = cleanReleaseTitle(r.title)
  return {
    id: r.id,
    title: cleaned.title,
    size: r.size,
    seeders: r.seeders,
    leechers: r.leechers,
    downloadUrl: r.downloadUrl,
    category: r.category,
    ...(cleaned.year !== undefined && { year: cleaned.year }),
    ...(cleaned.quality.length > 0 && { quality: cleaned.quality }),
    ...(cleaned.languages.length > 0 && { languages: cleaned.languages }),
  }
}

// --- Subscriptions ---

export interface SubscriptionView {
  id: string
  showId: number
  title: string
  lastNotifiedEpisode: { season: number; episode: number } | null
  poster: string | null
  latestAiredEpisode: { season: number; episode: number; airDate: string } | null
}

export function serializeSubscription(s: Subscription): SubscriptionView {
  return {
    id: s.id,
    showId: s.showId,
    title: s.title,
    lastNotifiedEpisode: s.lastNotifiedEpisode ?? null,
    poster: s.poster ?? null,
    latestAiredEpisode: s.latestAiredEpisode ?? null,
  }
}

// --- Show search (myshows catalog) ---

export interface ShowSearchResultView {
  id: number
  title: string
  titleOriginal: string | null
  poster: string | null
  isSubscribed: boolean
}

export function serializeShowSearchResult(
  r: MyShowsSearchResult,
  subscribedIds: Set<number>
): ShowSearchResultView {
  return {
    id: r.id,
    title: r.title,
    titleOriginal: r.titleOriginal ?? null,
    poster: r.image ?? null,
    isSubscribed: subscribedIds.has(r.id),
  }
}

// --- Show detail (full show page) ---

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

/**
 * myshows returns show descriptions as HTML (`<p>…</p><h3>…</h3>`). The Mini App
 * renders text, not markup (`{{ description }}`), so a raw value shows the tags
 * verbatim. Normalize to plain text here: block-level tags become paragraph
 * breaks, the rest are stripped, common entities decoded. Keeps the normalized
 * contract free of raw markup.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|div|li|ul|ol)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function serializeShowDetail(
  show: MyShowsShowDetailed,
  subscribedIds: Set<number>,
  now: Date
): ShowDetailView {
  const nowMs = now.getTime()

  // Group episodes by season
  const seasonMap = new Map<number, ShowEpisodeView[]>()
  for (const ep of show.episodes) {
    const airDateMs = ep.airDateUTC ? new Date(ep.airDateUTC).getTime() : NaN
    const aired = !isNaN(airDateMs) && airDateMs <= nowMs

    const view: ShowEpisodeView = {
      episode: ep.episodeNumber,
      title: ep.title,
      airDate: ep.airDateUTC || null,
      aired,
    }

    const list = seasonMap.get(ep.seasonNumber) ?? []
    list.push(view)
    seasonMap.set(ep.seasonNumber, list)
  }

  // Sort seasons descending (latest first in the accordion)
  const seasons: ShowSeasonView[] = [...seasonMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, episodes]) => ({
      season,
      episodes: episodes.sort((a, b) => a.episode - b.episode),
    }))

  return {
    id: show.id,
    title: show.title,
    titleOriginal: show.titleOriginal ?? null,
    poster: show.image ?? null,
    description: show.description ? htmlToText(show.description) : null,
    isSubscribed: subscribedIds.has(show.id),
    seasons,
  }
}

// --- Health ---

export interface CpuView {
  userLoad: number
  systemLoad: number
}

export function serializeCpu(u: SystemUtilization): CpuView {
  return { userLoad: u.cpu.user_load, systemLoad: u.cpu.system_load }
}

export interface MemoryView {
  usedBytes: number
  totalBytes: number
  pct: number
}

export function serializeMemory(u: SystemUtilization): MemoryView {
  const totalBytes = u.memory.total_real * 1024 // DSM reports KB
  const pct = u.memory.real_usage
  const usedBytes = Math.round(totalBytes * (pct / 100))
  return { usedBytes, totalBytes, pct }
}

export interface VolumeView {
  path: string
  usedBytes: number
  totalBytes: number
  pct: number
  status: string
}

export function serializeVolumes(s: StorageInfo): VolumeView[] {
  return s.volumes.map((v) => {
    const totalBytes = Number(v.size.total)
    const usedBytes = Number(v.size.used)
    const pct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
    return { path: v.vol_path, usedBytes, totalBytes, pct, status: v.status }
  })
}

export interface DiskView {
  model: string
  tempC: number
  tempStatus: string
  status: string
  smart: string
}

export function serializeDisks(d: DiskInfo): DiskView[] {
  return d.disks.map((disk) => ({
    model: disk.model,
    tempC: disk.temp,
    tempStatus: disk.temperature_status,
    status: disk.status,
    smart: disk.smart_status,
  }))
}

export interface ProcessesView {
  topRam: Array<{ name: string; bytes: number }>
  topCpu: Array<{ name: string; pct: number }>
}

export function serializeProcesses(slices: ProcessGroupSlice[], topN = 3): ProcessesView {
  const byRam = [...slices].sort((a, b) => b.memory - a.memory).slice(0, topN)
  const byCpu = [...slices].sort((a, b) => b.cpu_utilization - a.cpu_utilization).slice(0, topN)
  return {
    topRam: byRam.map((s) => ({ name: s.name, bytes: s.memory })),
    topCpu: byCpu.map((s) => ({ name: s.name, pct: s.cpu_utilization })),
  }
}
