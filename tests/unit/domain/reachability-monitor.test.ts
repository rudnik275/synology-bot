import { describe, it, expect, beforeEach } from 'bun:test'
import { ReachabilityMonitor } from '../../../src/domain/reachability-monitor.ts'
import type { NasState, NasEvent } from '../../../src/domain/reachability-monitor.ts'
import type { ReachabilityResult } from '../../../src/infra/synology/types.ts'

// ---- Helpers ----

function makeOk(): ReachabilityResult {
  return { ok: true }
}

function makeFail(reason = 'connection refused'): ReachabilityResult {
  return { ok: false, reason }
}

interface TestHarness {
  monitor: ReachabilityMonitor
  events: Array<{ event: NasEvent; reason?: string }>
  state: NasState
  setCheck(result: ReachabilityResult): void
}

function makeHarness(initialState: NasState = 'reachable', debounceCount = 3): TestHarness {
  const events: Array<{ event: NasEvent; reason?: string }> = []
  let currentState: NasState = initialState
  let checkResult: ReachabilityResult = makeOk()

  const monitor = new ReachabilityMonitor(
    {
      checkReachability: async () => checkResult,
      onEvent: async (event, reason) => {
        events.push({ event, reason })
      },
      getState: () => currentState,
      setState: (s) => { currentState = s },
    },
    { debounceCount }
  )

  return {
    monitor,
    events,
    get state() { return currentState },
    setCheck(result: ReachabilityResult) { checkResult = result },
  }
}

// ---- Tests ----

describe('ReachabilityMonitor', () => {
  // Cycle 1: successful poll → no event, stays reachable
  it('starts up; isReachable returns ok → no event emitted', async () => {
    const h = makeHarness()
    h.setCheck(makeOk())

    await h.monitor.poll()

    expect(h.events).toHaveLength(0)
    expect(h.state).toBe('reachable')
  })

  // Cycle 2: one failure (debounce=3) → no event yet
  it('one failure with debounce=3 → no event, state still reachable', async () => {
    const h = makeHarness()
    h.setCheck(makeFail())

    await h.monitor.poll()

    expect(h.events).toHaveLength(0)
    expect(h.state).toBe('reachable')
  })

  // Cycle 3: two consecutive failures → still no event
  it('two consecutive failures → no event, still reachable', async () => {
    const h = makeHarness()
    h.setCheck(makeFail())

    await h.monitor.poll()
    await h.monitor.poll()

    expect(h.events).toHaveLength(0)
    expect(h.state).toBe('reachable')
  })

  // Cycle 4: three consecutive failures → single nas.down emitted, state unreachable
  it('three consecutive failures → nas.down emitted, state unreachable', async () => {
    const h = makeHarness()
    h.setCheck(makeFail('timeout'))

    await h.monitor.poll()
    await h.monitor.poll()
    await h.monitor.poll()

    expect(h.events).toHaveLength(1)
    expect(h.events[0].event).toBe('nas.down')
    expect(h.events[0].reason).toBe('timeout')
    expect(h.state).toBe('unreachable')
  })

  // Cycle 5: 4th failure while unreachable → NO additional event
  it('fourth failure while unreachable → no additional event', async () => {
    const h = makeHarness()
    h.setCheck(makeFail())

    await h.monitor.poll()
    await h.monitor.poll()
    await h.monitor.poll()
    // Now unreachable — 4th failure
    await h.monitor.poll()

    expect(h.events).toHaveLength(1)
    expect(h.events[0].event).toBe('nas.down')
  })

  // Cycle 6: success after unreachable → nas.recovered emitted, state reachable
  it('recovery after down → nas.recovered emitted, state reachable', async () => {
    const h = makeHarness()
    h.setCheck(makeFail())

    await h.monitor.poll()
    await h.monitor.poll()
    await h.monitor.poll()
    // Now unreachable
    expect(h.state).toBe('unreachable')

    h.setCheck(makeOk())
    await h.monitor.poll()

    expect(h.events).toHaveLength(2)
    expect(h.events[1].event).toBe('nas.recovered')
    expect(h.state).toBe('reachable')
  })

  // Cycle 7: success → fail → fail → success: counter resets, no events on partial failures
  it('success, fail, fail, success → counter resets between, no events', async () => {
    const h = makeHarness()

    h.setCheck(makeOk())
    await h.monitor.poll()

    h.setCheck(makeFail())
    await h.monitor.poll()
    await h.monitor.poll()

    h.setCheck(makeOk())
    await h.monitor.poll()

    // Failures reset on success, debounce not reached → no events
    expect(h.events).toHaveLength(0)
    expect(h.state).toBe('reachable')
  })

  // Cycle 8: state restored from store (start in unreachable) → further failure → NO duplicate nas.down
  it('state restored as unreachable on restart → failure → no duplicate nas.down', async () => {
    // Simulate: store said nas was already down before restart
    const h = makeHarness('unreachable')
    h.setCheck(makeFail())

    await h.monitor.poll()

    expect(h.events).toHaveLength(0)
    expect(h.state).toBe('unreachable')
  })

  // Cycle 9: state restored as unreachable → recovery → nas.recovered emitted
  it('state restored as unreachable → recovery → nas.recovered', async () => {
    const h = makeHarness('unreachable')
    h.setCheck(makeOk())

    await h.monitor.poll()

    expect(h.events).toHaveLength(1)
    expect(h.events[0].event).toBe('nas.recovered')
    expect(h.state).toBe('reachable')
  })

  // Cycle 10: with debounceCount=2 (from config), exactly 2 failures trigger down
  it('debounceCount=2: two failures → nas.down emitted', async () => {
    const h = makeHarness('reachable', 2)
    h.setCheck(makeFail())

    await h.monitor.poll()
    expect(h.events).toHaveLength(0)

    await h.monitor.poll()
    expect(h.events).toHaveLength(1)
    expect(h.events[0].event).toBe('nas.down')
  })
})
