import type { Task } from '../../infra/synology/types.ts'

/** Finished statuses — task is considered "done" if it's in one of these */
export const FINISHED_STATUSES: ReadonlySet<Task['status']> = new Set(['finished', 'seeding'])

/** Minimal store interface required by TaskMonitor (for testability) */
export interface TaskMonitorStore {
  wasNotifFired(taskId: string, event: string): boolean
  markNotifFired(taskId: string, event: string): void
  insertCompletion(taskId: string, completedAt: number): void
}

export type GetTasksFn = () => Promise<Task[]>
export type NotifyFn = (task: Task) => Promise<void>

/** A per-tick detector that receives the current task list */
export interface TaskDetector {
  evaluate(tasks: Task[]): Promise<void>
}

/**
 * TaskMonitor — pure polling logic, no I/O side-effects except through injected fns.
 * Designed to be testable without real timers or network.
 */
export class TaskMonitor {
  private getTasks: GetTasksFn
  private notify: NotifyFn
  private store: TaskMonitorStore
  private detectors: TaskDetector[]
  /**
   * Task ids handed to `notify` but not yet confirmed delivered. Prevents
   * duplicate enqueues across ticks while the downstream debouncer holds the
   * task. Persistence (notif_dedup + completion) happens only in
   * `markDelivered`, i.e. AFTER a successful Telegram send — at-least-once
   * delivery: a crash before delivery re-notifies on restart rather than
   * silently dropping the push (#291).
   */
  private pendingNotify = new Set<string>()

  constructor(
    getTasks: GetTasksFn,
    notify: NotifyFn,
    store: TaskMonitorStore,
    detectors: TaskDetector[] = []
  ) {
    this.getTasks = getTasks
    this.notify = notify
    this.store = store
    this.detectors = detectors
  }

  /** Allow replacing getTasks after construction (test helper). */
  setGetTasks(fn: GetTasksFn): void {
    this.getTasks = fn
  }

  /**
   * Execute one polling tick. Crash-safe: any error is swallowed and logged.
   */
  async tick(): Promise<void> {
    let tasks: Task[]
    try {
      tasks = await this.getTasks()
    } catch (err) {
      console.error('[TaskMonitor] tick failed — getTasks threw:', err)
      return
    }

    for (const task of tasks) {
      if (!FINISHED_STATUSES.has(task.status)) continue
      if (this.store.wasNotifFired(task.id, 'finished')) continue
      if (this.pendingNotify.has(task.id)) continue

      try {
        await this.notify(task)
      } catch (err) {
        console.error(`[TaskMonitor] notify failed for task ${task.id}:`, err)
        // Do not mark as pending — will retry next tick
        continue
      }

      // Enqueued downstream — don't persist yet; wait for markDelivered.
      this.pendingNotify.add(task.id)
    }

    // Run all per-tick detectors
    for (const detector of this.detectors) {
      try {
        await detector.evaluate(tasks)
      } catch (err) {
        console.error('[TaskMonitor] detector.evaluate threw:', err)
      }
    }
  }

  /**
   * Confirm a finished notification was actually delivered (Telegram send
   * succeeded). Only now do we persist the dedup marker and completion record.
   * Called by the delivery layer (FinishedDebouncer onDelivered in app.ts).
   */
  markDelivered(taskId: string): void {
    this.store.markNotifFired(taskId, 'finished')
    this.store.insertCompletion(taskId, Date.now())
    this.pendingNotify.delete(taskId)
  }
}

// Polling is driven externally via runPollingLoop (sleep-then-tick, no
// overlapping ticks — #284); TaskMonitor deliberately has no own timer.
