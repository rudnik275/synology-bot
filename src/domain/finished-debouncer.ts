import type { Task } from '../infra/synology/types.ts'

export interface FinishedDebouncerOptions {
  /** How long to wait after the first task before flushing (ms). Default: 60000 */
  windowMs: number
  /** If queue size at flush time is >= threshold, use grouped flush. Default: 3 */
  threshold: number
  /** Called once per task when below threshold */
  flushIndividual: (task: Task) => Promise<void>
  /** Called once with all tasks when at or above threshold */
  flushGrouped: (tasks: Task[]) => Promise<void>
}

/** Injectable clock interface for testability */
export interface Clock {
  now: () => number
  setTimeout: (cb: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
}

/**
 * FinishedDebouncer — collects finished tasks over a time window,
 * then flushes them individually (< threshold) or as a single grouped
 * message (>= threshold).
 *
 * The window starts when the first task arrives and lasts `windowMs`.
 * All tasks that arrive before the window expires are flushed together.
 * After flush, the next task starts a fresh window.
 */
export class FinishedDebouncer {
  private readonly opts: FinishedDebouncerOptions
  private readonly clock: Clock
  private queue: Task[] = []
  private timerId: number | null = null
  private disposed = false

  constructor(opts: FinishedDebouncerOptions, clock: Clock = realClock) {
    this.opts = opts
    this.clock = clock
  }

  /**
   * Enqueue a finished task. If no window is open, start one.
   */
  enqueue(task: Task): void {
    if (this.disposed) return
    this.queue.push(task)
    if (this.timerId === null) {
      this.timerId = this.clock.setTimeout(() => {
        this.flush()
      }, this.opts.windowMs)
    }
  }

  /**
   * Flush all queued tasks immediately and cancel any pending timer.
   * Called either by the timer or by dispose().
   */
  private flush(): void {
    if (this.timerId !== null) {
      this.clock.clearTimeout(this.timerId)
      this.timerId = null
    }
    const tasks = this.queue.splice(0)
    if (tasks.length === 0) return

    if (tasks.length >= this.opts.threshold) {
      // Fire-and-forget: errors logged, not propagated
      this.opts.flushGrouped(tasks).catch((err) => {
        console.error('[FinishedDebouncer] flushGrouped error:', err)
      })
    } else {
      for (const task of tasks) {
        this.opts.flushIndividual(task).catch((err) => {
          console.error('[FinishedDebouncer] flushIndividual error for task', task.id, ':', err)
        })
      }
    }
  }

  /**
   * Flush any pending tasks immediately and prevent further enqueues.
   * Call on graceful shutdown.
   */
  dispose(): void {
    this.disposed = true
    this.flush()
  }
}
