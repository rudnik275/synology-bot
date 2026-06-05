/**
 * Pure derivation helpers for the HomeHub S2 Variant B row summaries (ADR 0015, #223).
 *
 * Extracted as standalone pure functions (no Vue reactivity) so they are
 * independently testable without mounting a component. The hub consumes these
 * inside computed()s built on the real composables.
 */
import { formatBytes, formatSpeed } from '../format'
import { volumeSeverity } from './useHealth'
import type { TaskView, SubscriptionView } from '../types'
import type { Tone } from '../components/ui/tones'

// ── Downloads row ─────────────────────────────────────────────────────────────

/** Statuses that count toward "active" (downloading, waiting, finishing). */
function isActiveStatus(status: string): boolean {
  return status === 'downloading' || status === 'waiting' || status === 'finishing'
}

export interface DownloadsSummary {
  /** Number of tasks with active status. */
  activeCount: number
  /** Sum of speedBytesPerSec across all active tasks, formatted. "—" when zero. */
  aggregateSpeed: string
  /**
   * The active task with the highest speed (or the first active task if all
   * speeds are 0). Null when there are no active tasks.
   */
  topTask: { id: string; title: string; pct: number } | null
}

export function deriveDownloadsSummary(tasks: TaskView[]): DownloadsSummary {
  const active = tasks.filter((t) => isActiveStatus(t.status))

  const activeCount = active.length

  const totalSpeed = active.reduce((sum, t) => sum + t.speedBytesPerSec, 0)
  const aggregateSpeed = formatSpeed(totalSpeed)

  let topTask: DownloadsSummary['topTask'] = null
  if (active.length > 0) {
    let best = active[0]!
    for (const t of active) {
      if (t.speedBytesPerSec > best.speedBytesPerSec) best = t
    }
    topTask = { id: best.id, title: best.title, pct: best.pct }
  }

  return { activeCount, aggregateSpeed, topTask }
}

// ── NAS row ───────────────────────────────────────────────────────────────────

type VolumeShape = { path: string; usedBytes: number; totalBytes: number; pct: number; status: string }

export interface NasSummary {
  /** Busiest volume usage percentage (0–100), or null if no volumes. */
  pct: number | null
  /** POSIX basename of the busiest volume path, or null if no volumes. */
  volumeName: string | null
  /** Human-readable used-bytes label, or null if no volumes. */
  usedLabel: string | null
  /** Human-readable total-bytes label, or null if no volumes. */
  totalLabel: string | null
  /**
   * Accent tone for the capacity bar: green < 80%, orange 80–89%, red ≥ 90%.
   * Also drives the health dot bg in the hub row.
   */
  capTone: Tone
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function deriveNasSummary(volumes: VolumeShape[] | null): NasSummary {
  if (!volumes || volumes.length === 0) {
    return { pct: null, volumeName: null, usedLabel: null, totalLabel: null, capTone: 'green' }
  }

  let busiest = volumes[0]!
  for (const v of volumes) {
    if (v.pct > busiest.pct) busiest = v
  }

  const severity = volumeSeverity(busiest)
  const capTone: Tone = severity === 'bad' ? 'red' : severity === 'warn' ? 'orange' : 'green'

  return {
    pct: busiest.pct,
    volumeName: basename(busiest.path),
    usedLabel: formatBytes(busiest.usedBytes),
    totalLabel: formatBytes(busiest.totalBytes),
    capTone,
  }
}

// ── Shows row ─────────────────────────────────────────────────────────────────

export interface ShowEpisodeChip {
  id: string
  label: string // "Show Title · S01E02"
}

export interface ShowsSummary {
  /** Number of subscriptions with an unnotified aired episode. */
  newCount: number
  /** Up to 3 episode chips for the hub row display. */
  newEpisodes: ShowEpisodeChip[]
}

/** Zero-padded SxxEyy string. */
function fmtEp(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

/**
 * A subscription has a "new" episode when latestAiredEpisode is strictly
 * ahead of lastNotifiedEpisode (or lastNotifiedEpisode is null but
 * latestAiredEpisode exists).
 *
 * "Ahead" = later season, OR same season with a later episode number.
 */
function isNewEpisode(sub: SubscriptionView): boolean {
  const latest = sub.latestAiredEpisode
  if (!latest) return false

  const notified = sub.lastNotifiedEpisode
  if (!notified) return true // latestAired exists but we have never notified → new

  if (latest.season > notified.season) return true
  if (latest.season === notified.season && latest.episode > notified.episode) return true
  return false
}

const MAX_CHIPS = 3

export function deriveShowsSummary(subscriptions: SubscriptionView[]): ShowsSummary {
  const newSubs = subscriptions.filter(isNewEpisode)
  const newCount = newSubs.length

  const newEpisodes: ShowEpisodeChip[] = newSubs.slice(0, MAX_CHIPS).map((sub) => ({
    id: sub.id,
    label: `${sub.title} · ${fmtEp(sub.latestAiredEpisode!.season, sub.latestAiredEpisode!.episode)}`,
  }))

  return { newCount, newEpisodes }
}
