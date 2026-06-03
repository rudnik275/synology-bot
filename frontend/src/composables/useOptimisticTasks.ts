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
 * we've already seen; each *newly appeared* real id retires one placeholder
 * (oldest first). A TTL is the backstop if the real task never arrives (add
 * failed silently, or a task finished+vanished in the same tick and masked the
 * count). Shared across AddFlow (which adds) and useTasks (which reconciles).
 */

const PENDING_STATUS = 'pending'
const OPTIMISTIC_TTL_MS = 30_000

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
   * Retire placeholders as real tasks arrive. Each real id we haven't seen
   * before retires one placeholder (oldest first); a TTL clears any stragglers.
   */
  function reconcile(realTasks: TaskView[]): void {
    let appeared = 0
    for (const t of realTasks) {
      if (!seenRealIds.has(t.id)) {
        seenRealIds.add(t.id)
        appeared++
      }
    }
    // The very first reconcile only establishes the baseline — existing tasks
    // are "seen", not freshly arrived, so they must not retire placeholders.
    if (!initialized) {
      initialized = true
      appeared = 0
    }
    // Mutate the reactive array IN PLACE and only when something is actually
    // removed — reassigning it every call (even a no-op filter) would trigger a
    // re-render on every poll, which in tests races component teardown
    // (happy-dom `parent.insertBefore` null) and churns the live app.
    // Entries are in insertion (time) order, so the oldest sit at the front.
    if (appeared > 0 && state.entries.length > 0) {
      state.entries.splice(0, Math.min(appeared, state.entries.length))
    }
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
