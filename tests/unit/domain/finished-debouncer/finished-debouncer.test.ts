import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { FinishedDebouncer } from '../../../../src/domain/finished-debouncer.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

// --- Fake clock ---
class FakeClock {
  private _now: number = 0
  private timers: Array<{ at: number; cb: () => void; id: number }> = []
  private nextId = 1

  now(): number {
    return this._now
  }

  setTimeout(cb: () => void, ms: number): number {
    const id = this.nextId++
    this.timers.push({ at: this._now + ms, cb, id })
    return id
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id)
  }

  /** Advance time by ms and fire any timers that are due */
  advance(ms: number): void {
    this._now += ms
    const due = this.timers.filter((t) => t.at <= this._now)
    this.timers = this.timers.filter((t) => t.at > this._now)
    due.sort((a, b) => a.at - b.at)
    for (const t of due) {
      t.cb()
    }
  }

  pendingTimerCount(): number {
    return this.timers.length
  }
}

/** Flush is async — let the in-flight flush settle after advancing the clock. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function makeTask(id: string, title = `Task ${id}`): Task {
  return { id, title, status: 'finished', size: 1000 }
}

// --- Tests ---
describe('FinishedDebouncer', () => {
  let clock: FakeClock
  let individual: Task[]
  let grouped: Task[][]
  let delivered: string[]
  let debouncer: FinishedDebouncer

  beforeEach(() => {
    clock = new FakeClock()
    individual = []
    grouped = []
    delivered = []

    debouncer = new FinishedDebouncer(
      {
        windowMs: 60_000,
        threshold: 3,
        flushIndividual: async (task) => {
          individual.push(task)
        },
        flushGrouped: async (tasks) => {
          grouped.push([...tasks])
        },
        onDelivered: (task) => {
          delivered.push(task.id)
        },
      },
      {
        now: () => clock.now(),
        setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
      }
    )
  })

  afterEach(async () => {
    await debouncer.dispose()
  })

  // 1 task in window → flushIndividual called once
  it('enqueue 1 task, window expires → flushIndividual called once', async () => {
    debouncer.enqueue(makeTask('t1'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(1)
    expect(individual[0].id).toBe('t1')
    expect(grouped).toHaveLength(0)
  })

  // 2 tasks in window → flushIndividual called twice
  it('enqueue 2 tasks, window expires → flushIndividual called twice', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(2)
    expect(grouped).toHaveLength(0)
  })

  // 3 tasks in window → flushGrouped called once with all 3
  it('enqueue 3 tasks, window expires → flushGrouped called once with all 3', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  // 5 tasks in window → flushGrouped called once with all 5
  it('enqueue 5 tasks, window expires → flushGrouped called once with all 5', async () => {
    for (let i = 1; i <= 5; i++) {
      debouncer.enqueue(makeTask(`t${i}`))
    }
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(5)
  })

  // 12 tasks in window → flushGrouped called once with all 12 (debouncer doesn't truncate)
  it('enqueue 12 tasks, window expires → flushGrouped called once with all 12', async () => {
    for (let i = 1; i <= 12; i++) {
      debouncer.enqueue(makeTask(`t${i}`))
    }
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(12)
  })

  // Two batches: 3 tasks → flush → 4 more tasks → next window → flush again
  it('two separate batches flush independently', async () => {
    // First batch
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    clock.advance(60_000) // first window expires
    await settle()
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)

    // Second batch
    debouncer.enqueue(makeTask('t4'))
    debouncer.enqueue(makeTask('t5'))
    debouncer.enqueue(makeTask('t6'))
    debouncer.enqueue(makeTask('t7'))
    clock.advance(60_000) // second window expires
    await settle()
    expect(grouped).toHaveLength(2)
    expect(grouped[1]).toHaveLength(4)
    expect(individual).toHaveLength(0)
  })

  // Tasks arriving mid-window join the same flush
  it('tasks arriving mid-window are included in the same flush', async () => {
    debouncer.enqueue(makeTask('t1'))
    clock.advance(30_000) // still within window
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    clock.advance(30_000) // window expires
    await settle()
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })

  // dispose() flushes pending immediately
  it('dispose() flushes pending tasks immediately without waiting for window', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    // Don't advance clock — await dispose() directly
    await debouncer.dispose()
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })

  it('dispose() with 1 pending task flushes individually', async () => {
    debouncer.enqueue(makeTask('t1'))
    await debouncer.dispose()
    expect(individual).toHaveLength(1)
    expect(grouped).toHaveLength(0)
  })

  it('dispose() with empty queue is a no-op', async () => {
    await debouncer.dispose()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(0)
  })

  it('second window starts after first flush', async () => {
    // First batch (below threshold) → individual
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(2)
    expect(grouped).toHaveLength(0)

    // Second batch (at threshold) → grouped
    debouncer.enqueue(makeTask('t3'))
    debouncer.enqueue(makeTask('t4'))
    debouncer.enqueue(makeTask('t5'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(2) // unchanged
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })

  // --- At-least-once delivery (#291) ---

  it('onDelivered fires per task only after a successful send', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    expect(delivered).toHaveLength(0) // nothing delivered at enqueue time
    clock.advance(60_000)
    await settle()
    expect(delivered).toEqual(['t1', 't2'])
  })

  it('onDelivered fires for every task of a grouped flush', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    clock.advance(60_000)
    await settle()
    expect(grouped).toHaveLength(1)
    expect(delivered.sort()).toEqual(['t1', 't2', 't3'])
  })

  it('grouped flush failure → tasks re-queued and retried on next window, not lost', async () => {
    let groupedCalls = 0
    const sent: Task[][] = []
    const localDelivered: string[] = []
    const d = new FinishedDebouncer(
      {
        windowMs: 60_000,
        threshold: 3,
        flushIndividual: async () => {},
        flushGrouped: async (tasks) => {
          groupedCalls++
          if (groupedCalls === 1) throw new Error('telegram 502')
          sent.push([...tasks])
        },
        onDelivered: (task) => localDelivered.push(task.id),
      },
      {
        now: () => clock.now(),
        setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
      }
    )

    d.enqueue(makeTask('t1'))
    d.enqueue(makeTask('t2'))
    d.enqueue(makeTask('t3'))
    clock.advance(60_000) // first flush — fails
    await settle()
    expect(groupedCalls).toBe(1)
    expect(localDelivered).toHaveLength(0) // not marked delivered
    expect(clock.pendingTimerCount()).toBe(1) // retry window opened

    clock.advance(60_000) // retry flush — succeeds
    await settle()
    expect(groupedCalls).toBe(2)
    expect(sent).toHaveLength(1)
    expect(sent[0].map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(localDelivered.sort()).toEqual(['t1', 't2', 't3'])
  })

  it('individual flush partial failure → only the failed task is retried', async () => {
    const attempts: string[] = []
    const localDelivered: string[] = []
    let failOnce = true
    const d = new FinishedDebouncer(
      {
        windowMs: 60_000,
        threshold: 3,
        flushIndividual: async (task) => {
          attempts.push(task.id)
          if (task.id === 't2' && failOnce) {
            failOnce = false
            throw new Error('telegram 502')
          }
        },
        flushGrouped: async () => {},
        onDelivered: (task) => localDelivered.push(task.id),
      },
      {
        now: () => clock.now(),
        setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
      }
    )

    d.enqueue(makeTask('t1'))
    d.enqueue(makeTask('t2'))
    clock.advance(60_000) // t1 ok, t2 fails
    await settle()
    expect(attempts).toEqual(['t1', 't2'])
    expect(localDelivered).toEqual(['t1'])

    clock.advance(60_000) // retry window — only t2
    await settle()
    expect(attempts).toEqual(['t1', 't2', 't2'])
    expect(localDelivered).toEqual(['t1', 't2'])
  })

  it('flush failure at dispose() does not throw — tasks stay undelivered for restart re-notify', async () => {
    const d = new FinishedDebouncer(
      {
        windowMs: 60_000,
        threshold: 3,
        flushIndividual: async () => { throw new Error('telegram down') },
        flushGrouped: async () => { throw new Error('telegram down') },
        onDelivered: (task) => delivered.push(task.id),
      },
      {
        now: () => clock.now(),
        setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
      }
    )

    d.enqueue(makeTask('t1'))
    await d.dispose() // must not throw
    expect(delivered).toHaveLength(0) // dedup never persisted → re-notified on restart
  })

  it('enqueue after dispose() is ignored', async () => {
    await debouncer.dispose()
    debouncer.enqueue(makeTask('t1'))
    clock.advance(60_000)
    await settle()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(0)
  })
})

// Notifier formatting (notifyFinishedGrouped) is covered exhaustively in
// tests/unit/domain/notifier/notifier.test.ts — no duplication here.
