// TDD tests for hub S2 (#223) summary derivation helpers.
//
// Pure-function unit tests written FIRST (red → green → refactor).
// Each helper is extracted into frontend/src/composables/hubSummaries.ts so
// these derivations are independently testable, not buried in the component.

import { describe, it, expect } from 'bun:test'
import {
  deriveDownloadsSummary,
  deriveNasSummary,
  deriveShowsSummary,
} from '../src/composables/hubSummaries'
import type { TaskView, SubscriptionView } from '../src/types'

// ── TaskView fixtures ────────────────────────────────────────────────────────

const makeTask = (overrides: Partial<TaskView> = {}): TaskView => ({
  id: 'task-1',
  title: 'Some Movie.mkv',
  status: 'downloading',
  sizeBytes: 1_000_000_000,
  downloadedBytes: 500_000_000,
  speedBytesPerSec: 5_242_880, // 5 MB/s
  pct: 50,
  destination: '/downloads',
  ...overrides,
})

const ACTIVE_TASK: TaskView = makeTask({ status: 'downloading', speedBytesPerSec: 5_242_880, pct: 50 })
const WAITING_TASK: TaskView = makeTask({ id: 'task-2', title: 'Another Show.mkv', status: 'waiting', speedBytesPerSec: 0, pct: 0 })
const FINISHING_TASK: TaskView = makeTask({ id: 'task-3', status: 'finishing', speedBytesPerSec: 1_000_000, pct: 95 })
const PAUSED_TASK: TaskView = makeTask({ id: 'task-4', status: 'paused', speedBytesPerSec: 0, pct: 30 })
const FINISHED_TASK: TaskView = makeTask({ id: 'task-5', status: 'finished', speedBytesPerSec: 0, pct: 100 })
const SEEDING_TASK: TaskView = makeTask({ id: 'task-6', status: 'seeding', speedBytesPerSec: 0, pct: 100 })
const ERROR_TASK: TaskView = makeTask({ id: 'task-7', status: 'error', speedBytesPerSec: 0, pct: 0 })

describe('deriveDownloadsSummary', () => {
  it('returns zero count and no top task for empty list', () => {
    const result = deriveDownloadsSummary([])
    expect(result.activeCount).toBe(0)
    expect(result.topTask).toBeNull()
    expect(result.aggregateSpeed).toBe('—')
  })

  it('counts downloading, waiting, and finishing tasks as active', () => {
    const result = deriveDownloadsSummary([ACTIVE_TASK, WAITING_TASK, FINISHING_TASK])
    expect(result.activeCount).toBe(3)
  })

  it('does NOT count paused, finished, seeding, or error tasks as active', () => {
    const result = deriveDownloadsSummary([PAUSED_TASK, FINISHED_TASK, SEEDING_TASK, ERROR_TASK])
    expect(result.activeCount).toBe(0)
  })

  it('mixed: counts only the active statuses', () => {
    const result = deriveDownloadsSummary([ACTIVE_TASK, PAUSED_TASK, FINISHED_TASK])
    expect(result.activeCount).toBe(1)
  })

  it('aggregates speed across all active tasks', () => {
    // ACTIVE: 5 MB/s, FINISHING: 1 MB/s → 6 MB/s
    const result = deriveDownloadsSummary([ACTIVE_TASK, FINISHING_TASK, PAUSED_TASK])
    expect(result.aggregateSpeed).toBe('6.0 MB/s')
  })

  it('aggregateSpeed is "—" when no tasks are active', () => {
    const result = deriveDownloadsSummary([PAUSED_TASK, FINISHED_TASK])
    expect(result.aggregateSpeed).toBe('—')
  })

  it('picks the active task with the highest speed as topTask', () => {
    const fast: TaskView = { ...ACTIVE_TASK, id: 'fast', speedBytesPerSec: 10_000_000, pct: 20 }
    const slow: TaskView = { ...ACTIVE_TASK, id: 'slow', speedBytesPerSec: 1_000_000, pct: 80 }
    const result = deriveDownloadsSummary([slow, fast])
    expect(result.topTask?.id).toBe('fast')
  })

  it('falls back to first downloading task if all speeds are 0', () => {
    const a: TaskView = { ...WAITING_TASK, id: 'a', speedBytesPerSec: 0 }
    const b: TaskView = { ...WAITING_TASK, id: 'b', speedBytesPerSec: 0 }
    const result = deriveDownloadsSummary([a, b])
    expect(result.topTask?.id).toBe('a')
  })

  it('topTask is null when there are no active tasks', () => {
    const result = deriveDownloadsSummary([FINISHED_TASK])
    expect(result.topTask).toBeNull()
  })

  it('exposes topTask.title and topTask.pct', () => {
    const task: TaskView = makeTask({ title: 'My Download', pct: 42 })
    const result = deriveDownloadsSummary([task])
    expect(result.topTask?.title).toBe('My Download')
    expect(result.topTask?.pct).toBe(42)
  })
})

// ── HealthView volume fixtures ───────────────────────────────────────────────

type VolumeShape = { path: string; usedBytes: number; totalBytes: number; pct: number; status: string }

const makeVolume = (overrides: Partial<VolumeShape> = {}): VolumeShape => ({
  path: '/volume1',
  usedBytes: 680_000_000_000,  // 680 GB
  totalBytes: 1_000_000_000_000, // 1 TB
  pct: 68,
  status: 'normal',
  ...overrides,
})

describe('deriveNasSummary', () => {
  it('returns null values when volumes is null', () => {
    const result = deriveNasSummary(null)
    expect(result.pct).toBeNull()
    expect(result.volumeName).toBeNull()
    expect(result.usedLabel).toBeNull()
    expect(result.totalLabel).toBeNull()
  })

  it('returns null values when volumes array is empty', () => {
    const result = deriveNasSummary([])
    expect(result.pct).toBeNull()
    expect(result.volumeName).toBeNull()
  })

  it('returns the busiest volume pct', () => {
    const vols = [makeVolume({ pct: 68 }), makeVolume({ path: '/volume2', pct: 45 })]
    const result = deriveNasSummary(vols)
    expect(result.pct).toBe(68)
  })

  it('picks the volume with the highest pct', () => {
    const vols = [
      makeVolume({ path: '/volume1', pct: 60 }),
      makeVolume({ path: '/volume2', pct: 90 }),
    ]
    const result = deriveNasSummary(vols)
    expect(result.pct).toBe(90)
    expect(result.volumeName).toBe('volume2')
  })

  it('extracts basename from the volume path', () => {
    const result = deriveNasSummary([makeVolume({ path: '/volume1', pct: 68 })])
    expect(result.volumeName).toBe('volume1')
  })

  it('formats usedLabel and totalLabel as human-readable bytes', () => {
    const result = deriveNasSummary([makeVolume({ usedBytes: 1_073_741_824, totalBytes: 2_147_483_648, pct: 50 })])
    // 1 GB used, 2 GB total
    expect(result.usedLabel).toBe('1.0 GB')
    expect(result.totalLabel).toBe('2.0 GB')
  })

  it('computes capTone: green at < 80%, orange at 80–89%, red at >= 90%', () => {
    expect(deriveNasSummary([makeVolume({ pct: 50 })]).capTone).toBe('green')
    expect(deriveNasSummary([makeVolume({ pct: 80 })]).capTone).toBe('orange')
    expect(deriveNasSummary([makeVolume({ pct: 89 })]).capTone).toBe('orange')
    expect(deriveNasSummary([makeVolume({ pct: 90 })]).capTone).toBe('red')
    expect(deriveNasSummary([makeVolume({ pct: 100 })]).capTone).toBe('red')
  })
})

// ── SubscriptionView fixtures ────────────────────────────────────────────────

// Fixed "now" for all deriveShowsSummary tests: 2024-06-05T12:00:00Z
const NOW = new Date('2024-06-05T12:00:00Z')

/** Returns an ISO string representing `daysAgo` days before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

/** Returns an ISO string representing `daysAhead` days after NOW. */
function daysAhead(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

const makeSub = (overrides: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: 'sub-1',
  showId: 42,
  title: 'Breaking Bad',
  lastNotifiedEpisode: { season: 5, episode: 15 },
  poster: null,
  // Default airDate: 1 day ago (within 3-day window)
  latestAiredEpisode: { season: 5, episode: 16, airDate: daysAgo(1) },
  ...overrides,
})

describe('deriveShowsSummary', () => {
  it('returns zero newCount for empty subscriptions', () => {
    const result = deriveShowsSummary([], NOW)
    expect(result.newCount).toBe(0)
    expect(result.newEpisodes).toEqual([])
  })

  it('counts subscription as new if latestAiredEpisode aired 1 day ago (within 3-day window)', () => {
    const sub = makeSub({ latestAiredEpisode: { season: 5, episode: 16, airDate: daysAgo(1) } })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newCount).toBe(1)
  })

  it('counts subscription as new if latestAiredEpisode aired exactly 3 days ago (boundary inclusive)', () => {
    const sub = makeSub({ latestAiredEpisode: { season: 5, episode: 16, airDate: daysAgo(3) } })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newCount).toBe(1)
  })

  it('does NOT count subscription as new if latestAiredEpisode aired 4 days ago', () => {
    const sub = makeSub({ latestAiredEpisode: { season: 5, episode: 16, airDate: daysAgo(4) } })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newCount).toBe(0)
  })

  it('does NOT count subscription as new if latestAiredEpisode is in the future', () => {
    const sub = makeSub({ latestAiredEpisode: { season: 5, episode: 17, airDate: daysAhead(1) } })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newCount).toBe(0)
  })

  it('does NOT count subscription as new if latestAiredEpisode is null', () => {
    const sub = makeSub({ latestAiredEpisode: null })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newCount).toBe(0)
  })

  it('returns episode chips for new subscriptions: showTitle + SxxEyy', () => {
    const sub = makeSub({ title: 'Breaking Bad', latestAiredEpisode: { season: 5, episode: 16, airDate: daysAgo(1) } })
    const result = deriveShowsSummary([sub], NOW)
    expect(result.newEpisodes[0]).toEqual({ label: 'Breaking Bad · S05E16', id: 'sub-1' })
  })

  it('limits newEpisodes to 3 chips maximum', () => {
    const subs: SubscriptionView[] = Array.from({ length: 5 }, (_, i) =>
      makeSub({ id: `sub-${i}`, showId: i, title: `Show ${i}`, lastNotifiedEpisode: null, latestAiredEpisode: { season: 1, episode: i + 1, airDate: daysAgo(1) } })
    )
    const result = deriveShowsSummary(subs, NOW)
    expect(result.newEpisodes.length).toBe(3)
  })

  it('newCount reflects only episodes within the 3-day window, not chips cap', () => {
    const subs: SubscriptionView[] = Array.from({ length: 5 }, (_, i) =>
      makeSub({ id: `sub-${i}`, showId: i, title: `Show ${i}`, lastNotifiedEpisode: null, latestAiredEpisode: { season: 1, episode: i + 1, airDate: daysAgo(1) } })
    )
    const result = deriveShowsSummary(subs, NOW)
    expect(result.newCount).toBe(5)
  })

  it('handles mix: some within 3-day window, some outside', () => {
    const subs: SubscriptionView[] = [
      makeSub({ id: 'sub-1', showId: 1, latestAiredEpisode: { season: 1, episode: 1, airDate: daysAgo(1) } }),  // new
      makeSub({ id: 'sub-2', showId: 2, latestAiredEpisode: { season: 2, episode: 1, airDate: daysAgo(2) } }),  // new
      makeSub({ id: 'sub-3', showId: 3, latestAiredEpisode: { season: 3, episode: 1, airDate: daysAgo(4) } }),  // old
      makeSub({ id: 'sub-4', showId: 4, latestAiredEpisode: { season: 4, episode: 1, airDate: daysAhead(1) } }), // future
      makeSub({ id: 'sub-5', showId: 5, latestAiredEpisode: null }),                                              // null
    ]
    const result = deriveShowsSummary(subs, NOW)
    expect(result.newCount).toBe(2)
  })

  it('uses new Date() as default when now param is omitted (smoke test)', () => {
    // Just verifies it doesn't throw and returns a valid shape
    const result = deriveShowsSummary([])
    expect(result.newCount).toBe(0)
    expect(result.newEpisodes).toEqual([])
  })
})
