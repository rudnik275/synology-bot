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
}

function makeTask(id: string, title = `Task ${id}`): Task {
  return { id, title, status: 'finished', size: 1000 }
}

// --- Tests ---
describe('FinishedDebouncer', () => {
  let clock: FakeClock
  let individual: Task[]
  let grouped: Task[][]
  let debouncer: FinishedDebouncer

  beforeEach(() => {
    clock = new FakeClock()
    individual = []
    grouped = []

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
      },
      {
        now: () => clock.now(),
        setTimeout: (cb, ms) => clock.setTimeout(cb, ms),
        clearTimeout: (id) => clock.clearTimeout(id),
      }
    )
  })

  afterEach(() => {
    debouncer.dispose()
  })

  // 1 task in window → flushIndividual called once
  it('enqueue 1 task, window expires → flushIndividual called once', async () => {
    debouncer.enqueue(makeTask('t1'))
    clock.advance(60_000)
    expect(individual).toHaveLength(1)
    expect(individual[0].id).toBe('t1')
    expect(grouped).toHaveLength(0)
  })

  // 2 tasks in window → flushIndividual called twice
  it('enqueue 2 tasks, window expires → flushIndividual called twice', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    clock.advance(60_000)
    expect(individual).toHaveLength(2)
    expect(grouped).toHaveLength(0)
  })

  // 3 tasks in window → flushGrouped called once with all 3
  it('enqueue 3 tasks, window expires → flushGrouped called once with all 3', async () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    clock.advance(60_000)
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
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)

    // Second batch
    debouncer.enqueue(makeTask('t4'))
    debouncer.enqueue(makeTask('t5'))
    debouncer.enqueue(makeTask('t6'))
    debouncer.enqueue(makeTask('t7'))
    clock.advance(60_000) // second window expires
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
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })

  // dispose() flushes pending immediately
  it('dispose() flushes pending tasks immediately without waiting for window', () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    debouncer.enqueue(makeTask('t3'))
    // Don't advance clock — call dispose() directly
    debouncer.dispose()
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })

  it('dispose() with 1 pending task flushes individually', () => {
    debouncer.enqueue(makeTask('t1'))
    debouncer.dispose()
    expect(individual).toHaveLength(1)
    expect(grouped).toHaveLength(0)
  })

  it('dispose() with empty queue is a no-op', () => {
    debouncer.dispose()
    expect(individual).toHaveLength(0)
    expect(grouped).toHaveLength(0)
  })

  it('second window starts after first flush', () => {
    // First batch (below threshold) → individual
    debouncer.enqueue(makeTask('t1'))
    debouncer.enqueue(makeTask('t2'))
    clock.advance(60_000)
    expect(individual).toHaveLength(2)
    expect(grouped).toHaveLength(0)

    // Second batch (at threshold) → grouped
    debouncer.enqueue(makeTask('t3'))
    debouncer.enqueue(makeTask('t4'))
    debouncer.enqueue(makeTask('t5'))
    clock.advance(60_000)
    expect(individual).toHaveLength(2) // unchanged
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toHaveLength(3)
  })
})

// --- Notifier grouped message formatter tests ---
describe('Notifier.notifyFinishedGrouped', () => {
  // We import Notifier here separately
  let sent: Array<{ chatId: number; text: string }>

  beforeEach(() => {
    sent = []
  })

  it('formats ≤10 tasks as full list', async () => {
    const { Notifier } = await import('../../../../src/domain/notifier/notifier.ts')
    const store = { getKv: (_key: string) => '123456' }
    const notifier = new Notifier(store as any, async (chatId, text) => {
      sent.push({ chatId, text })
    })

    const tasks: Task[] = Array.from({ length: 3 }, (_, i) =>
      makeTask(`t${i + 1}`, `Movie ${i + 1}`)
    )
    await notifier.notifyFinishedGrouped(tasks)
    expect(sent).toHaveLength(1)
    const text = sent[0].text
    expect(text).toContain('✅')
    expect(text).toContain('(3)')
    expect(text).toContain('Movie 1')
    expect(text).toContain('Movie 2')
    expect(text).toContain('Movie 3')
    expect(text).not.toContain('и ещё')
  })

  it('truncates to 10 entries + "...и ещё K" for 12 tasks', async () => {
    const { Notifier } = await import('../../../../src/domain/notifier/notifier.ts')
    const store = { getKv: (_key: string) => '123456' }
    const notifier = new Notifier(store as any, async (chatId, text) => {
      sent.push({ chatId, text })
    })

    const tasks: Task[] = Array.from({ length: 12 }, (_, i) =>
      makeTask(`t${i + 1}`, `Movie ${i + 1}`)
    )
    await notifier.notifyFinishedGrouped(tasks)
    expect(sent).toHaveLength(1)
    const text = sent[0].text
    expect(text).toContain('(12)')
    // Should have 10 bullet lines
    const bulletCount = (text.match(/^• /gm) ?? []).length
    expect(bulletCount).toBe(10)
    expect(text).toContain('...и ещё 2')
  })

  it('no-op when owner_chat_id not set', async () => {
    const { Notifier } = await import('../../../../src/domain/notifier/notifier.ts')
    const store = { getKv: (_key: string) => undefined }
    const notifier = new Notifier(store as any, async (chatId, text) => {
      sent.push({ chatId, text })
    })

    const tasks: Task[] = [makeTask('t1')]
    await notifier.notifyFinishedGrouped(tasks)
    expect(sent).toHaveLength(0)
  })
})
