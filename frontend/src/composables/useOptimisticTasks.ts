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
}

const state = reactive<{ entries: OptimisticEntry[] }>({ entries: [] })
// Real task ids already observed — persists for the app session so the first
// poll's existing tasks are treated as "seen" and never retire a placeholder.
const seenRealIds = new Set<string>()
let initialized = false

function now(): number {
  return Date.now()
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
}

export function useOptimisticTasks() {
  /** Insert a placeholder card immediately; returns its temp id for rollback. */
  function add(input: { title: string; destination: string | null }): string {
    const id = `optimistic-${crypto.randomUUID()}`
    state.entries.push({
      createdAt: now(),
      task: {
        id,
        title: input.title || 'Добавление…',
        status: PENDING_STATUS,
        sizeBytes: 0,
        downloadedBytes: 0,
        speedBytesPerSec: 0,
        pct: 0,
        destination: input.destination,
      },
    })
    return id
  }

  /** Remove a placeholder by id (e.g. the add request failed). */
  function remove(id: string): void {
    const i = state.entries.findIndex((e) => e.task.id === id)
    if (i >= 0) state.entries.splice(i, 1)
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
    } else {
      // For each newly-appeared real task, find the oldest placeholder that
      // matches by normalized title OR normalized destination, then retire it.
      for (const t of newlyAppeared) {
        if (state.entries.length === 0) break

        const tTitle = normalizeTitle(t.title)
        const tDest = normalizeDest(t.destination)

        // entries are insertion-order (oldest at index 0) — find the first match.
        const matchIdx = state.entries.findIndex((e) => {
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
    // 30 s TTL backstop: evict any placeholder that outlived the window.
    const cutoff = now() - OPTIMISTIC_TTL_MS
    for (let i = state.entries.length - 1; i >= 0; i--) {
      if (state.entries[i].createdAt < cutoff) state.entries.splice(i, 1)
    }
  }

  /** Placeholders as TaskViews, newest first (shown above real tasks). */
  function pendingTasks(): TaskView[] {
    return [...state.entries].sort((a, b) => b.createdAt - a.createdAt).map((e) => e.task)
  }

  return { add, remove, reconcile, pendingTasks }
}
