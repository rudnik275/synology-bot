/**
 * Tests for runPollingLoop — the supervised-interval helper that backs the
 * four watchers in src/app.ts.
 *
 * Pattern: inject a FakeSleep so we control when each interval fires without
 * real wall-clock waits. The fake sleep queues pending resolvers; advance()
 * fires the next one. This mirrors the FakeClock pattern in finished-debouncer.
 */
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import { runPollingLoop } from '../../../src/lib/runPollingLoop.ts'

// ---------- FakeSleep --------------------------------------------------------

/**
 * Controllable async sleep.
 * `sleep(ms)` returns a Promise that stays pending until `advance()` is called.
 * `advance()` resolves the oldest pending promise (FIFO), simulating one
 * interval elapsing.
 */
class FakeSleep {
  private pending: Array<() => void> = []

  sleep = (_ms: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      this.pending.push(resolve)
    })
  }

  /** Resolve the next pending sleep promise (fire one tick). */
  advance(): void {
    const resolve = this.pending.shift()
    if (resolve) resolve()
  }

  get pendingCount(): number {
    return this.pending.length
  }
}

// ---------- Helpers ----------------------------------------------------------

function drainMicrotasks(): Promise<void> {
  // Yield to the microtask queue so that .then() continuations run.
  return new Promise((r) => setTimeout(r, 0))
}

// ---------- Tests ------------------------------------------------------------

describe('runPollingLoop', () => {
  let fake: FakeSleep

  beforeEach(() => {
    fake = new FakeSleep()
  })

  it('calls tick once per interval when advanced', async () => {
    const calls: number[] = []
    let n = 0

    runPollingLoop({
      intervalMs: 5_000,
      name: 'TestLoop',
      tick: async () => { calls.push(++n) },
      _sleep: fake.sleep,
    })

    // No tick yet — loop is waiting for first sleep
    await drainMicrotasks()
    expect(calls).toHaveLength(0)

    // Advance one interval → tick fires
    fake.advance()
    await drainMicrotasks()
    expect(calls).toEqual([1])

    // Advance again → second tick
    fake.advance()
    await drainMicrotasks()
    expect(calls).toEqual([1, 2])

    // Advance again → third tick
    fake.advance()
    await drainMicrotasks()
    expect(calls).toEqual([1, 2, 3])
  })

  it('swallows a throwing tick, logs it via console.error with name, and continues', async () => {
    const errors: unknown[] = []
    const spy = spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })

    const successCalls: number[] = []

    runPollingLoop({
      intervalMs: 1_000,
      name: 'BoomLoop',
      tick: async () => {
        throw new Error('tick exploded')
      },
      _sleep: fake.sleep,
    })

    // First interval → tick throws
    fake.advance()
    await drainMicrotasks()

    // Error was logged and contains the loop name
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const logged = JSON.stringify(errors[0])
    expect(logged).toContain('BoomLoop')

    // Loop is still alive — a second interval can fire
    fake.advance()
    await drainMicrotasks()
    expect(errors.length).toBeGreaterThanOrEqual(2)

    spy.mockRestore()
  })

  it('stop() halts further ticks', async () => {
    const calls: number[] = []
    let n = 0

    const { stop } = runPollingLoop({
      intervalMs: 2_000,
      name: 'StopLoop',
      tick: async () => { calls.push(++n) },
      _sleep: fake.sleep,
    })

    // Fire one tick
    fake.advance()
    await drainMicrotasks()
    expect(calls).toHaveLength(1)

    // Stop the loop
    stop()

    // Advance another interval — tick must NOT fire
    fake.advance()
    await drainMicrotasks()
    expect(calls).toHaveLength(1)

    // Further advances are also silent
    fake.advance()
    await drainMicrotasks()
    expect(calls).toHaveLength(1)
  })

  it('slow tick never overlaps the next one (#284)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    let finishTick: (() => void) | null = null

    runPollingLoop({
      intervalMs: 1_000,
      name: 'SlowLoop',
      tick: () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        return new Promise<void>((resolve) => {
          finishTick = () => { concurrent--; resolve() }
        })
      },
      _sleep: fake.sleep,
    })

    // First interval elapses → tick starts and stays in flight
    fake.advance()
    await drainMicrotasks()
    expect(concurrent).toBe(1)

    // While the tick is in flight, the loop has NOT queued another sleep —
    // so no further interval can start a second tick.
    expect(fake.pendingCount).toBe(0)

    // Finish the slow tick → loop sleeps again → next tick can fire
    finishTick!()
    await drainMicrotasks()
    expect(fake.pendingCount).toBe(1)

    fake.advance()
    await drainMicrotasks()
    expect(concurrent).toBe(1) // second tick now in flight, alone
    expect(maxConcurrent).toBe(1) // never two ticks at once

    finishTick!()
    await drainMicrotasks()
  })

  it('stop() before first tick prevents any tick from firing', async () => {
    const calls: number[] = []

    const { stop } = runPollingLoop({
      intervalMs: 3_000,
      name: 'EarlyStop',
      tick: async () => { calls.push(1) },
      _sleep: fake.sleep,
    })

    // Stop immediately, before any advance
    stop()

    fake.advance()
    await drainMicrotasks()
    expect(calls).toHaveLength(0)
  })
})
