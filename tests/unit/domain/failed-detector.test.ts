import { describe, it, expect } from 'bun:test'
import { FailedDetector } from '../../../src/domain/failed-detector.ts'
import type { FailedDetectorStore, FailedAlertOptions } from '../../../src/domain/failed-detector.ts'
import type { Task } from '../../../src/infra/synology/types.ts'

// ---- Helpers ----

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: `Task ${overrides.id}`,
    status: 'downloading',
    size: 1000,
    ...overrides,
  }
}

interface TestHarness {
  detector: FailedDetector
  alerts: FailedAlertOptions[]
  store: FailedDetectorStore & { fired: Set<string> }
}

function makeHarness(): TestHarness {
  const fired = new Set<string>()

  const store: FailedDetectorStore & { fired: Set<string> } = {
    fired,
    wasNotifFired: (taskId, event) => fired.has(`${taskId}:${event}`),
    markNotifFired: (taskId, event) => { fired.add(`${taskId}:${event}`) },
  }

  const alerts: FailedAlertOptions[] = []

  return {
    detector: new FailedDetector({
      store,
      sendAlert: async (opts) => { alerts.push(opts) },
    }),
    alerts,
    store,
  }
}

// ---- Tests ----

describe('FailedDetector', () => {
  it('task not in error status → no alert', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', status: 'downloading' })

    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(0)
  })

  it('task in error status → alert fired once', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', status: 'error' })

    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(1)
    expect(h.alerts[0].taskId).toBe('task-1')
    expect(h.alerts[0].text).toContain('Ошибка')
    expect(h.alerts[0].text).toContain('error')
  })

  it('same task in error next tick → no duplicate alert (dedup)', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', status: 'error' })

    await h.detector.evaluate([task]) // fires
    await h.detector.evaluate([task]) // must NOT fire again

    expect(h.alerts).toHaveLength(1)
  })

  it('different tasks in error → each fires independently', async () => {
    const h = makeHarness()
    const task1 = makeTask({ id: 'task-1', status: 'error' })
    const task2 = makeTask({ id: 'task-2', status: 'error' })

    await h.detector.evaluate([task1, task2])

    expect(h.alerts).toHaveLength(2)
    const ids = h.alerts.map((a) => a.taskId)
    expect(ids).toContain('task-1')
    expect(ids).toContain('task-2')
  })

  it('alert text includes task title', async () => {
    const h = makeHarness()
    const task = makeTask({ id: 'task-1', status: 'error', title: 'Broken Torrent File' })

    await h.detector.evaluate([task])

    expect(h.alerts[0].text).toContain('Broken Torrent File')
  })

  it('task in non-error status → no alert; previously fired → dedup preserved', async () => {
    const h = makeHarness()
    h.store.fired.add('task-1:failed')

    const task = makeTask({ id: 'task-1', status: 'error' })
    await h.detector.evaluate([task])

    expect(h.alerts).toHaveLength(0)
  })
})
