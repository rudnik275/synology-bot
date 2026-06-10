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
  /**
   * Called once per task AFTER its notification was successfully sent.
   * Used to persist dedup/completion state only on confirmed delivery (#291).
   */
  onDelivered?: (task: Task) => void
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
  /** In-flight flush, if any — chained so flushes never overlap. */
  private flushing: Promise<void> = Promise.resolve()

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
    this.startTimer()
  }

  private startTimer(): void {
    if (this.timerId !== null || this.disposed) return
    this.timerId = this.clock.setTimeout(() => {
      this.timerId = null
      void this.flush()
    }, this.opts.windowMs)
  }

  /**
   * Flush all queued tasks and cancel any pending timer. Awaitable.
   *
   * At-least-once delivery (#291): tasks whose send failed are re-queued and
   * retried on the next window — a transient Telegram error must never drop a
   * finished notification. `onDelivered` fires per task only after a
   * successful send.
   */
  flush(): Promise<void> {
    // Chain onto any in-flight flush so two flushes never interleave.
    this.flushing = this.flushing.then(() => this.doFlush())
    return this.flushing
  }

  private async doFlush(): Promise<void> {
    if (this.timerId !== null) {
      this.clock.clearTimeout(this.timerId)
      this.timerId = null
    }
    const tasks = this.queue.splice(0)
    if (tasks.length === 0) return

    const failed: Task[] = []

    if (tasks.length >= this.opts.threshold) {
      try {
        await this.opts.flushGrouped(tasks)
        for (const task of tasks) this.opts.onDelivered?.(task)
      } catch (err) {
        console.error('[FinishedDebouncer] flushGrouped error (will retry):', err)
        failed.push(...tasks)
      }
    } else {
      for (const task of tasks) {
        try {
          await this.opts.flushIndividual(task)
          this.opts.onDelivered?.(task)
        } catch (err) {
          console.error('[FinishedDebouncer] flushIndividual error for task', task.id, '(will retry):', err)
          failed.push(task)
        }
      }
    }

    if (failed.length > 0) {
      // Re-queue unsent tasks ahead of anything enqueued mid-flush and open
      // a new window so they are retried.
      this.queue.unshift(...failed)
      this.startTimer()
    }
  }

  /**
   * Flush any pending tasks immediately and prevent further enqueues.
   * Awaitable — call (and await) on graceful shutdown so pending finished
   * notifications are sent before the process exits.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timerId !== null) {
      this.clock.clearTimeout(this.timerId)
      this.timerId = null
    }
    await this.flush()
  }
}
