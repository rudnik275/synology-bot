/**
 * Unit tests for useOptimisticTasks reconcile-by-identity logic (#202).
 *
 * The global afterEach in test-setup.ts calls resetOptimisticTasks() so
 * module-singleton state never leaks between tests.
 *
 * All tests follow the same pattern:
 *   1. baseline reconcile (initializes seenRealIds without retiring anything)
 *   2. add() one or more placeholders
 *   3. reconcile() with newly-appeared real tasks
 *   4. assert pendingTasks() length / content
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { useOptimisticTasks, resetOptimisticTasks } from '../src/composables/useOptimisticTasks'
import type { TaskView } from '../src/types'

/** Minimal TaskView factory for real (polled) tasks. */
function realTask(overrides: Partial<TaskView> & { id: string; title: string }): TaskView {
  return {
    status: 'downloading',
    sizeBytes: 0,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    pct: 0,
    destination: null,
    ...overrides,
  }
}

beforeEach(() => {
  // Explicit reset before each test — belt-and-suspenders alongside the global afterEach.
  resetOptimisticTasks()
})

describe('useOptimisticTasks — reconcile by identity', () => {
  it('title match retires the placeholder', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    // Establish baseline (no retirement on first call)
    reconcile([])

    add({ title: 'Dune 2024', destination: '/video' })
    expect(pendingTasks()).toHaveLength(1)

    reconcile([realTask({ id: 'r1', title: 'Dune 2024', destination: '/video' })])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('normalized title match: dots-and-case differ but match', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    // Placeholder title has dots and mixed case
    add({ title: 'Dune.2024.2160p', destination: '/video' })
    expect(pendingTasks()).toHaveLength(1)

    // Real task title uses spaces and lowercase — should still match
    reconcile([realTask({ id: 'r1', title: 'dune 2024 2160p', destination: '/video' })])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('destination match when title differs (infohash case)', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    add({ title: 'Настоящий детектив S04', destination: '/video' })
    expect(pendingTasks()).toHaveLength(1)

    // Real task has an infohash-style title but same destination
    reconcile([realTask({ id: 'r1', title: 'abc123def456abc123def456', destination: '/video' })])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('no match → placeholder NOT retired (external add)', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    add({ title: 'Dune 2024', destination: '/video' })
    expect(pendingTasks()).toHaveLength(1)

    // External add — different title AND different destination
    reconcile([realTask({ id: 'r1', title: 'Other Movie', destination: '/downloads' })])
    expect(pendingTasks()).toHaveLength(1)
  })

  it('two quick adds to same dest reconcile FIFO (oldest first)', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    add({ title: 'Movie A', destination: '/video' })
    add({ title: 'Movie B', destination: '/video' })
    expect(pendingTasks()).toHaveLength(2)

    // Real task for A appears — A (oldest) should be retired, B stays
    reconcile([realTask({ id: 'r1', title: 'Movie A', destination: '/video' })])
    const remaining = pendingTasks()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].title).toBe('Movie B')

    // Real task for B appears — B should be retired
    reconcile([realTask({ id: 'r2', title: 'Movie B', destination: '/video' })])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('TTL backstop clears a straggler placeholder after OPTIMISTIC_TTL_MS', async () => {
    // We need to mock Date.now to control time.
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    const realNow = Date.now
    let fakeNow = realNow()

    // Override Date.now for the composable
    const origDateNow = Date.now
    Date.now = () => fakeNow

    try {
      reconcile([])
      add({ title: 'Orphan', destination: '/video' })
      expect(pendingTasks()).toHaveLength(1)

      // Advance time past 30 s TTL
      fakeNow += 30_001

      // Next reconcile call should evict the stale placeholder via TTL sweep
      reconcile([])
      expect(pendingTasks()).toHaveLength(0)
    } finally {
      Date.now = origDateNow
    }
  })

  it('baseline: first reconcile with pre-existing tasks does NOT retire placeholders', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    // Add a placeholder BEFORE the first reconcile (unusual but valid)
    add({ title: 'Movie Pre', destination: '/video' })
    expect(pendingTasks()).toHaveLength(1)

    // First reconcile — establishes baseline; should NOT retire the placeholder
    reconcile([realTask({ id: 'existing1', title: 'Movie Pre', destination: '/video' })])
    expect(pendingTasks()).toHaveLength(1)

    // Second reconcile with a genuinely new task that matches
    reconcile([
      realTask({ id: 'existing1', title: 'Movie Pre', destination: '/video' }),
      realTask({ id: 'new1', title: 'Movie Pre', destination: '/video' }),
    ])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('null/empty destination never matches as a dest key', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    // Placeholder with null destination
    add({ title: 'Movie Null Dest', destination: null })
    expect(pendingTasks()).toHaveLength(1)

    // Real task also has null destination — only title should match
    reconcile([realTask({ id: 'r1', title: 'Totally Different', destination: null })])
    // destination is null on both, so dest match must be skipped; title doesn't match
    expect(pendingTasks()).toHaveLength(1)
  })

  it('destination match is normalized: leading/trailing slashes and case ignored', () => {
    const { add, reconcile, pendingTasks } = useOptimisticTasks()

    reconcile([])

    add({ title: 'Some Show', destination: '/Video/' })
    expect(pendingTasks()).toHaveLength(1)

    // Real task has same path, different slash style and case
    reconcile([realTask({ id: 'r1', title: 'infohash-abc123', destination: 'video' })])
    expect(pendingTasks()).toHaveLength(0)
  })
})

describe('useOptimisticTasks — time-driven TTL sweep (#303)', () => {
  it('evicts a stale placeholder via the periodic sweep when reconcile never runs (frozen polling)', () => {
    // Polling failure means `tasks` never changes → reconcile never runs. The
    // module-level interval must evict TTL-expired placeholders on its own.
    const origSetInterval = globalThis.setInterval
    const origClearInterval = globalThis.clearInterval
    const origDateNow = Date.now
    let fakeNow = origDateNow()
    let tick: (() => void) | null = null
    let cleared = false
    globalThis.setInterval = ((fn: () => void) => {
      tick = fn
      return 0 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    globalThis.clearInterval = (() => {
      cleared = true
    }) as typeof clearInterval
    Date.now = () => fakeNow

    try {
      const { add, pendingTasks } = useOptimisticTasks()
      add({ title: 'Frozen Poll Orphan', destination: '/video' })
      expect(pendingTasks()).toHaveLength(1)
      // add() must have scheduled the sweep interval.
      expect(tick).not.toBeNull()

      // Inside the TTL window — the sweep keeps the placeholder.
      fakeNow += 10_000
      tick!()
      expect(pendingTasks()).toHaveLength(1)

      // Past the 30 s TTL — the sweep evicts it WITHOUT any reconcile call.
      fakeNow += 20_001
      tick!()
      expect(pendingTasks()).toHaveLength(0)
      // And the timer stops once nothing is pending.
      expect(cleared).toBe(true)
    } finally {
      globalThis.setInterval = origSetInterval
      globalThis.clearInterval = origClearInterval
      Date.now = origDateNow
    }
  })
})

describe('useOptimisticTasks — real-id (attachRealId + reconcile by id)', () => {
  it('attachRealId surfaces the real id on the pending task', () => {
    const { add, attachRealId, pendingTasks } = useOptimisticTasks()
    const id = add({ title: 'Movie', destination: '/video' })
    expect(pendingTasks()[0].realId).toBeUndefined()

    attachRealId(id, 'dbid_42')
    expect(pendingTasks()[0].realId).toBe('dbid_42')
  })

  it('attachRealId on an unknown/retired id is a no-op (does not throw)', () => {
    const { attachRealId, pendingTasks } = useOptimisticTasks()
    attachRealId('optimistic-gone', 'dbid_x')
    expect(pendingTasks()).toHaveLength(0)
  })

  it('baseline reconcile retires a placeholder whose attached realId is in the baseline (#303)', () => {
    const { add, attachRealId, reconcile, pendingTasks } = useOptimisticTasks()

    // The add resolved (realId attached) BEFORE the first poll returned — the
    // baseline list already contains the real task, so keeping the placeholder
    // would duplicate the card forever (the id is "seen", never "new" again).
    const id = add({ title: 'Movie', destination: '/video' })
    attachRealId(id, 'dbid_7')
    expect(pendingTasks()).toHaveLength(1)

    // First reconcile (baseline). Title/dest drifted — only the exact id ties them.
    reconcile([realTask({ id: 'dbid_7', title: 'Renamed.mkv', destination: '/elsewhere' })])
    expect(pendingTasks()).toHaveLength(0)
  })

  it('baseline reconcile does NOT retire a placeholder with a realId absent from the baseline', () => {
    const { add, attachRealId, reconcile, pendingTasks } = useOptimisticTasks()

    const id = add({ title: 'Movie', destination: '/video' })
    attachRealId(id, 'dbid_404')
    reconcile([realTask({ id: 'other', title: 'Movie', destination: '/video' })])
    // Title/dest match a pre-existing task, but baseline identity matches must
    // not retire; the attached id isn't present either → placeholder stays.
    expect(pendingTasks()).toHaveLength(1)
  })

  it('reconcile retires by EXACT real-id match even when title AND dest drift', () => {
    const { add, attachRealId, reconcile, pendingTasks } = useOptimisticTasks()
    reconcile([])

    const id = add({ title: 'Tracker Name 2015', destination: '/video/новое' })
    attachRealId(id, 'dbid_99')
    expect(pendingTasks()).toHaveLength(1)

    // DSM renamed the torrent AND reports a different-looking destination — only
    // the exact real-id ties them together.
    reconcile([realTask({ id: 'dbid_99', title: 'Completely Different.mkv', destination: '/elsewhere' })])
    expect(pendingTasks()).toHaveLength(0)
  })
})
