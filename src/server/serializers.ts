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
}

export function serializeSubscription(s: Subscription): SubscriptionView {
  return {
    id: s.id,
    showId: s.showId,
    title: s.title,
    lastNotifiedEpisode: s.lastNotifiedEpisode ?? null,
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
