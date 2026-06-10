import { reactive } from 'vue'

/**
 * Failed-add store (module singleton, #288). The fully-optimistic commit (#161)
 * closes the Add sheet INSTANTLY and runs the add in the background; on failure
 * the pending «Добавление…» placeholder is rolled back (useOptimisticTasks) —
 * but with the sheet long gone there was nowhere to say WHY the card vanished,
 * so a failed add looked like a silent success-then-disappearance.
 *
 * This store keeps the failure visible: AddFlow records an entry when a
 * background add rejects, DownloadsTab renders it as a red «Ошибка добавления»
 * card pinned above the list, and it persists until the owner dismisses it
 * (no TTL — unlike placeholders, a failure must not silently evaporate).
 *
 * Shared across AddFlow (writes) and DownloadsTab (reads/dismisses), mirroring
 * the useOptimisticTasks split.
 */

export interface AddFailure {
  id: string
  /** The title the failed add was attempted with (what the card showed). */
  title: string
  destination: string | null
  /** The error message from the failed add request. */
  message: string
}

const state = reactive<{ entries: AddFailure[] }>({ entries: [] })

/**
 * Clear all module-singleton state. Tests share one process, so without this
 * failures leak between tests; the global afterEach in test-setup.ts calls it.
 * Not used by the app.
 */
export function resetAddFailures(): void {
  state.entries.splice(0)
}

export function useAddFailures() {
  /** Record a failed add; returns the entry id. Newest first. */
  function add(input: { title: string; destination: string | null; message: string }): string {
    const id = `add-failure-${crypto.randomUUID()}`
    state.entries.unshift({ id, ...input })
    return id
  }

  /** Dismiss a failure card (the ✕ on the card). */
  function dismiss(id: string): void {
    const i = state.entries.findIndex((e) => e.id === id)
    if (i >= 0) state.entries.splice(i, 1)
  }

  /** The live (reactive) failure list, newest first. */
  const failures = state.entries

  return { add, dismiss, failures }
}
