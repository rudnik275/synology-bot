const DAY_MS = 24 * 60 * 60 * 1000

export interface AutoCleanerDeps {
  /** Fetch task IDs that completed before the given timestamp (ms since epoch). */
  getCompleted: (cutoffMs: number) => Promise<string[]>
  /** Delete a task entry from DownloadStation (keeps files). Returns ok:false on error. */
  deleteTask: (taskId: string) => Promise<{ ok: true } | { ok: false; reason: string }>
  /** Remove the task_completion row (dedup cleanup). */
  removeCompletion: (taskId: string) => Promise<void>
  /** Remove ALL notif_dedup rows for the task (any event) once it is deleted (#300). */
  clearNotifDedup: (taskId: string) => Promise<void>
  /** Safety sweep (#300): delete orphan notif_dedup rows with fired_at older than the cutoff. */
  sweepOrphanNotifDedup: (cutoffMs: number) => Promise<void>
  /** Purge expired add-intake stashes (.torrent blobs / magnet URIs) (#300). */
  pruneExpiredStashes: () => Promise<void>
  /** Send a notification message to the owner. */
  notify: (message: string) => Promise<void>
  /** Number of days to retain completed task entries. Default 7. */
  retentionDays: number
  /** Inject current time for deterministic testing. Defaults to Date.now. */
  now: () => number
}

/**
 * AutoCleaner is a pure domain class (all I/O injected).
 *
 * One call to `cleanup()` = one tick:
 *  1. Query completed tasks older than retentionDays.
 *  2. For each, call deleteTask (removes task entry from DownloadStation, keeps files).
 *  3. On success, call removeCompletion + clearNotifDedup to clean up dedup rows.
 *  4. On Synology error: log and skip (next tick will retry).
 *  5. If any tasks were deleted, send one summary push to the owner.
 *  6. Housekeeping (#300, every tick): sweep orphan notif_dedup rows older than
 *     the retention cutoff and prune expired torrent stashes.
 */
export class AutoCleaner {
  private readonly deps: AutoCleanerDeps

  constructor(deps: AutoCleanerDeps) {
    this.deps = deps
  }

  async cleanup(): Promise<void> {
    const cutoffMs = this.deps.now() - this.deps.retentionDays * DAY_MS
    const taskIds = await this.deps.getCompleted(cutoffMs)

    let deletedCount = 0

    for (const taskId of taskIds) {
      try {
        const result = await this.deps.deleteTask(taskId)
        if (!result.ok) {
          console.warn(`[AutoCleaner] deleteTask(${taskId}) failed: ${result.reason} — will retry next tick`)
          continue
        }
        await this.deps.removeCompletion(taskId)
        await this.deps.clearNotifDedup(taskId)
        deletedCount++
      } catch (err) {
        console.error(`[AutoCleaner] Unexpected error processing task ${taskId}:`, err)
      }
    }

    // Housekeeping (#300): runs every tick, regardless of whether tasks were found.
    try {
      await this.deps.sweepOrphanNotifDedup(cutoffMs)
      await this.deps.pruneExpiredStashes()
    } catch (err) {
      console.error('[AutoCleaner] Housekeeping sweep failed:', err)
    }

    if (deletedCount > 0) {
      const retentionDays = this.deps.retentionDays
      await this.deps.notify(
        `🧹 Автоматически удалено ${deletedCount} завершённых задач старше ${retentionDays} дней (файлы сохранены)`
      )
    }
  }
}
