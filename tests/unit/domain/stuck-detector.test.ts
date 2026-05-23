import { describe, it, expect, beforeEach } from 'bun:test'
import { StuckDetector } from '../../../src/domain/stuck-detector.ts'
import type { StuckDetectorStore, StuckAlertOptions } from '../../../src/domain/stuck-detector.ts'
import type { Task } from '../../../src/infra/synology/types.ts'

// ---- Helpers ----

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: `Task ${overrides.id}`,
    status: 'downloading',
    size: 1000,
    additional: {
      transfer: { speed_download: 0 },
    },
    ...overrides,
  }
}

interface TestHarness {
  detector: StuckDetector
  alerts: StuckAlertOptions[]
  store: StuckDetectorStore & {
    fired: Set<string>
  }
  currentTime: number
}

function makeHarness(thresholdMs = 5 * 60 * 1000): TestHarness {
  let currentTime = 0

  const fired = new Set<string>()

  const store: StuckDetectorStore & { fired: Set<string> } = {
    fired,
    wasNotifFired: (taskId, event) => fired.has(`${taskId}:${event}`),
    markNotifFired: (taskId, event) => { fired.add(`${taskId}:${event}`) },
    clearNotifFired: (taskId, event) => { fired.delete(`${taskId}:${event}`) },
  }

  const alerts: StuckAlertOptions[] = []

  const harness: TestHarness = {
    detector: new StuckDetector({
      zeroSpeedThresholdMs: thresholdMs,
      store,
      sendAlert: async (opts) => { alerts.push(opts) },
      now: () => currentTime,
    }),
    alerts,
    store,
    get currentTime() { return currentTime },
    set currentTime(v) { currentTime = v },
  }

  return harness
}

// ---- Tests ----

describe('StuckDetector', () => {
  it('task downloading + speed > 0 → no alert', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 1024 } } })

    h.currentTime = 0
    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(0)
  })

  it('task downloading + speed = 0 (first observation) → no alert, just starts timer', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(0)
  })

  it('task downloading + speed = 0 + 4 min elapsed → no alert (threshold not reached)', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([task])

    h.currentTime = 4 * 60 * 1000 // 4 minutes
    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(0)
  })

  it('task downloading + speed = 0 + 5 min elapsed → alert fired', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([task]) // starts timer

    h.currentTime = 5 * 60 * 1000 // exactly 5 minutes
    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(1)
    expect(h.alerts[0].taskId).toBe('task-1')
    expect(h.alerts[0].text).toContain('Зависло')
    expect(h.alerts[0].text).toContain('5 мин')
  })

  it('same task in next tick → no duplicate alert (dedup)', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([task])

    h.currentTime = 5 * 60 * 1000
    await h.detector.evaluate([task]) // fires alert

    h.currentTime = 7 * 60 * 1000
    await h.detector.evaluate([task]) // should NOT fire again

    expect(h.alerts).toHaveLength(1)
  })

  it('task transitions to seeding → timer cleared, dedup cleared, new stall can fire', async () => {
    const h = makeHarness()
    const stuckTask = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([stuckTask])

    h.currentTime = 5 * 60 * 1000
    await h.detector.evaluate([stuckTask]) // fires

    expect(h.alerts).toHaveLength(1)

    // Task starts seeding — timer and dedup should be cleared
    const seedingTask = makeTask({ id: 'task-1', status: 'seeding', additional: { transfer: { speed_download: 0 } } })
    h.currentTime = 6 * 60 * 1000
    await h.detector.evaluate([seedingTask])

    expect(h.store.wasNotifFired('task-1', 'stuck')).toBe(false)

    // Now task returns to downloading with speed 0 — new 5-min countdown
    h.currentTime = 7 * 60 * 1000
    await h.detector.evaluate([stuckTask]) // first zero-speed observation again

    h.currentTime = 12 * 60 * 1000
    await h.detector.evaluate([stuckTask]) // should fire again

    expect(h.alerts).toHaveLength(2)
  })

  it('task speed becomes non-zero → timer and dedup cleared', async () => {
    const h = makeHarness()
    const stuckTask = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([stuckTask])

    h.currentTime = 5 * 60 * 1000
    await h.detector.evaluate([stuckTask]) // fires

    // Task now has speed — clear timer
    const activeTask = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 500 } } })
    h.currentTime = 6 * 60 * 1000
    await h.detector.evaluate([activeTask])

    expect(h.store.wasNotifFired('task-1', 'stuck')).toBe(false)
  })

  it('alert text includes task title', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', title: 'My Great Movie' })

    h.currentTime = 0
    await h.detector.evaluate([task])

    h.currentTime = 5 * 60 * 1000
    await h.detector.evaluate([task])

    expect(h.alerts[0].text).toContain('My Great Movie')
  })

  it('task not in list → timer and dedup cleared', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })

    h.currentTime = 0
    await h.detector.evaluate([task])

    // Task disappears from list (e.g. deleted externally)
    h.currentTime = 3 * 60 * 1000
    await h.detector.evaluate([]) // empty list

    // Timer should be gone; if it re-appears, fresh countdown
    const task2 = makeTask({ id: 'task-1', additional: { transfer: { speed_download: 0 } } })
    h.currentTime = 4 * 60 * 1000
    await h.detector.evaluate([task2]) // first obs again

    h.currentTime = 9 * 60 * 1000
    await h.detector.evaluate([task2]) // should fire once

    expect(h.alerts).toHaveLength(1)
  })
})
