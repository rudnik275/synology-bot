import { reactive } from 'vue'
import type { TaskView } from '../types'

/**
 * Optimistic-add store (module singleton). When the owner taps «Добавить», the
 * server + DownloadStation take a few seconds to register the task and the
 * Downloads poll runs only every 3 s, so the list used to look unchanged right
 * after adding ("I pressed add and nothing happened"). We instead drop a
 * placeholder card in immediately (status `pending` → a loader), then retire it
 * once the real task shows up on a poll.
 *
 * Reconciliation needs no server cooperation: we remember which real task ids
 * we've already seen; each *newly appeared* real task is matched against
 * outstanding placeholders by **normalized title OR normalized destination**
 * (whichever matches first, oldest placeholder wins — FIFO). A TTL is the
 * backstop if the real task never arrives (add failed silently, or a task
 * finished+vanished in the same tick). Shared across AddFlow (adds) and
 * useTasks (reconciles).
 *
 * Identity rules (ADR-0012):
 *   normalizeTitle: lowercase, replace runs of [._] with a space, collapse
 *     whitespace, trim.
 *   normalizeDest:  strip leading/trailing slashes, lowercase, trim; an
 *     empty/null destination is never used as a match key.
 * A real task matching no placeholder retires nothing — external adds (e.g.
 * from the Telegram bot) never wrongly consume a live placeholder.
 */

const PENDING_STATUS = 'pending'
const OPTIMISTIC_TTL_MS = 30_000

// ── Identity helpers ────────────────────────────────────────────────────────

/** Normalize a torrent title for identity matching. */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize a destination path for identity matching.
 * Returns an empty string when the input is null/empty — callers must skip
 * dest matching when the result is empty.
 */
function normalizeDest(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/^\/+|\/+$/g, '').toLowerCase().trim()
}

interface OptimisticEntry {
  task: TaskView
  createdAt: number
  /**
   * The real DSM task id, once the add request resolves with one (attachRealId).
   * Lets reconcile retire this placeholder by EXACT id match (robust even when
   * DSM renames the torrent so title/dest no longer match) and lets the pending
   * card's «удалить» cancel the download by its real id before the next poll
   * surfaces it. Undefined until the add resolves / if DSM returned no id.
   */
  realId?: string
}

/** A pending placeholder as a TaskView, carrying its real DSM id once known. */
export type PendingTaskView = TaskView & { realId?: string }

const state = reactive<{ entries: OptimisticEntry[] }>({ entries: [] })
// Real task ids already observed — persists for the app session so the first
// poll's existing tasks are treated as "seen" and never retire a placeholder.
const seenRealIds = new Set<string>()
let initialized = false

function now(): number {
  return Date.now()
}

// ── Time-driven TTL sweep (#303) ────────────────────────────────────────────
// TTL eviction used to live only inside reconcile(), which only runs when the
// polled task list CHANGES — when polling fails (network down, server error)
// `tasks` never changes, reconcile never runs, and stale placeholders outlive
// the 30 s TTL forever (frozen «Добавление…» card, stuck cancel spinner). A
// module-level interval makes eviction time-driven: it runs while any
// placeholder exists and splices the reactive array, so consumers (computed
// pendingTasks → watchers) wake up even when polling is dead.
const SWEEP_INTERVAL_MS = 5_000

let sweepTimer: ReturnType<typeof setInterval> | null = null

/** Evict placeholders past the TTL; stop the timer once nothing is pending. */
export function sweepExpiredOptimisticTasks(): void {
  const cutoff = now() - OPTIMISTIC_TTL_MS
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (state.entries[i].createdAt < cutoff) state.entries.splice(i, 1)
  }
  if (state.entries.length === 0) stopSweepTimer()
}

function ensureSweepTimer(): void {
  if (sweepTimer === null) sweepTimer = setInterval(sweepExpiredOptimisticTasks, SWEEP_INTERVAL_MS)
}

function stopSweepTimer(): void {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

export function isPending(status: string): boolean {
  return status === PENDING_STATUS
}

/**
 * Clear all module-singleton state. Tests share one process, so without this the
 * placeholders / seen-id baseline leak between tests; the global afterEach in
 * test-setup.ts calls it. Not used by the app.
 */
export function resetOptimisticTasks(): void {
  state.entries.splice(0)
  seenRealIds.clear()
  initialized = false
  stopSweepTimer()
}

export function useOptimisticTasks() {
  /**
   * Insert a placeholder card immediately; returns its temp id for rollback.
   *
   * `sizeBytes` / `year` / `quality` / `languages` are the bits AddFlow already
   * knows at commit time (from the inspected file tree + the search result). They
   * are optional — magnets and un-inspected sources have no size yet — and let
   * the pending card render the info we DO know and fall back to a skeleton only
   * for what we don't (instead of a generic spinner).
   */
  function add(input: {
    title: string
    destination: string | null
    sizeBytes?: number
    year?: number
    quality?: string[]
    languages?: string[]
  }): string {
    const id = `optimistic-${crypto.randomUUID()}`
    state.entries.push({
      createdAt: now(),
      task: {
        id,
        title: input.title || 'Добавление…',
        status: PENDING_STATUS,
        sizeBytes: input.sizeBytes ?? 0,
        downloadedBytes: 0,
        speedBytesPerSec: 0,
        pct: 0,
        destination: input.destination,
        year: input.year,
        quality: input.quality,
        languages: input.languages,
      },
    })
    // Time-driven TTL backstop (#303): runs while any placeholder exists.
    ensureSweepTimer()
    return id
  }

  /** Remove a placeholder by id (e.g. the add request failed). */
  function remove(id: string): void {
    const i = state.entries.findIndex((e) => e.task.id === id)
    if (i >= 0) state.entries.splice(i, 1)
  }

  /**
   * Record the real DSM task id on a placeholder once the add request resolves
   * with one. No-op if the placeholder is already gone (retired/removed/TTL).
   * Enables exact-id reconcile + cancel-by-real-id on the pending card.
   */
  function attachRealId(optimisticId: string, realId: string): void {
    const entry = state.entries.find((e) => e.task.id === optimisticId)
    if (entry) entry.realId = realId
  }

  /**
   * Retire placeholders as real tasks arrive. Each newly-appeared real task is
   * matched against outstanding placeholders by normalized title OR normalized
   * destination (whichever matches first). The oldest matching placeholder is
   * retired (splice). A real task matching no placeholder retires nothing — an
   * external add (from the bot, say) never wrongly consumes a live placeholder.
   *
   * The very first call only establishes the "seen" baseline — existing real
   * tasks are marked seen but retire nothing, preserving placeholders that were
   * added before the first poll returned.
   *
   * Mutates the reactive array IN PLACE and only when something is actually
   * removed — reassigning it every call (even a no-op filter) would trigger a
   * re-render on every poll, which in tests races component teardown
   * (happy-dom `parent.insertBefore` null) and churns the live app.
   */
  function reconcile(realTasks: TaskView[]): void {
    // Collect newly-appeared real tasks (ids not yet seen).
    const newlyAppeared: TaskView[] = []
    for (const t of realTasks) {
      if (!seenRealIds.has(t.id)) {
        seenRealIds.add(t.id)
        newlyAppeared.push(t)
      }
    }
    // The very first reconcile only establishes the baseline — existing tasks
    // are "seen", not freshly arrived, so they must not retire placeholders.
    if (!initialized) {
      initialized = true
      // newlyAppeared is discarded; entries are in insertion (time) order.
      // EXCEPTION (#303): a placeholder whose attached realId is present in the
      // baseline IS its real task — the add resolved before the first poll
      // returned, so keeping the placeholder would duplicate the card. Exact-id
      // matches are unambiguous (unlike title/dest identity, which must NOT
      // retire on the baseline — pre-existing tasks aren't freshly arrived).
      const baselineIds = new Set(realTasks.map((t) => t.id))
      for (let i = state.entries.length - 1; i >= 0; i--) {
        const rid = state.entries[i].realId
        if (rid && baselineIds.has(rid)) state.entries.splice(i, 1)
      }
    } else {
      // For each newly-appeared real task, find the oldest placeholder that
      // matches by normalized title OR normalized destination, then retire it.
      for (const t of newlyAppeared) {
        if (state.entries.length === 0) break

        const tTitle = normalizeTitle(t.title)
        const tDest = normalizeDest(t.destination)

        // entries are insertion-order (oldest at index 0) — find the first match.
        // Prefer an EXACT real-id match (set by attachRealId): it's unambiguous
        // and survives DSM renaming the torrent so title/dest drift. Fall back to
        // the normalized title OR destination identity match.
        const matchIdx = state.entries.findIndex((e) => {
          if (e.realId && e.realId === t.id) return true
          if (normalizeTitle(e.task.title) === tTitle) return true
          const eDest = normalizeDest(e.task.destination)
          return eDest !== '' && tDest !== '' && eDest === tDest
        })

        if (matchIdx >= 0) {
          state.entries.splice(matchIdx, 1)
        }
        // No match → no retirement; external/unrelated adds leave placeholders alone.
      }
    }
    // 30 s TTL backstop: evict any placeholder that outlived the window. The
    // periodic sweep timer covers the polling-frozen case (#303); sweeping here
    // too keeps eviction immediate on every poll.
    sweepExpiredOptimisticTasks()
  }

  /** Placeholders as TaskViews (with realId once known), newest first. */
  function pendingTasks(): PendingTaskView[] {
    return [...state.entries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({ ...e.task, realId: e.realId }))
  }

  return { add, remove, attachRealId, reconcile, pendingTasks }
}
