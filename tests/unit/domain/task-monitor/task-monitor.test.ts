import { describe, it, expect, beforeEach } from 'bun:test'
import { TaskMonitor } from '../../../../src/domain/task-monitor/task-monitor.ts'
import type { TaskMonitorStore } from '../../../../src/domain/task-monitor/task-monitor.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

// ---- Helpers ----

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: `Task ${overrides.id}`,
    status: 'finished',
    size: 1000,
    additional: {
      detail: { destination: '/downloads' },
      transfer: { speed_download: 0 },
    },
    ...overrides,
  }
}

interface FakeStore extends TaskMonitorStore {
  fired: Set<string>
  completions: Array<{ taskId: string; completedAt: number }>
}

function makeFakeStore(): FakeStore {
  const fired = new Set<string>()
  const completions: Array<{ taskId: string; completedAt: number }> = []
  return {
    fired,
    completions,
    wasNotifFired: (taskId, event) => fired.has(`${taskId}:${event}`),
    markNotifFired: (taskId, event) => { fired.add(`${taskId}:${event}`) },
    insertCompletion: (taskId, completedAt) => { completions.push({ taskId, completedAt }) },
  }
}

// ---- Tests ----

describe('TaskMonitor', () => {
  let store: FakeStore
  let notified: Task[]

  beforeEach(() => {
    store = makeFakeStore()
    notified = []
  })

  it('finished task → notify called, marked as fired', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'finished' })],
      async (task) => { notified.push(task) },
      store
    )

    await monitor.tick()

    expect(notified).toHaveLength(1)
    expect(notified[0].id).toBe('task-1')
    expect(store.wasNotifFired('task-1', 'finished')).toBe(true)
  })

  it('same finished task in next tick → no duplicate notify (dedup)', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'finished' })],
      async (task) => { notified.push(task) },
      store
    )

    await monitor.tick()
    await monitor.tick()

    expect(notified).toHaveLength(1)
  })

  it('seeding task is treated as finished', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'seeding' })],
      async (task) => { notified.push(task) },
      store
    )

    await monitor.tick()

    expect(notified).toHaveLength(1)
  })

  it('downloading task → NOT notified', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'downloading' })],
      async (task) => { notified.push(task) },
      store
    )

    await monitor.tick()

    expect(notified).toHaveLength(0)
  })

  it('getTasks throws → tick is crash-safe (no throw)', async () => {
    const monitor = new TaskMonitor(
      async () => { throw new Error('NAS down') },
      async (task) => { notified.push(task) },
      store
    )

    await expect(monitor.tick()).resolves.toBeUndefined()
  })

  it('insertCompletion called on first finish notification', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'finished' })],
      async (task) => { notified.push(task) },
      store
    )

    await monitor.tick()

    expect(store.completions).toHaveLength(1)
    expect(store.completions[0].taskId).toBe('task-1')
  })

  it('detector.evaluate is called on each tick', async () => {
    const evaluated: Task[][] = []
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'downloading' })],
      async () => {},
      store,
      [{ evaluate: async (tasks) => { evaluated.push(tasks) } }]
    )

    await monitor.tick()
    await monitor.tick()

    expect(evaluated).toHaveLength(2)
    expect(evaluated[0]).toHaveLength(1)
  })

  it('detector error is caught, tick continues', async () => {
    const monitor = new TaskMonitor(
      async () => [makeTask({ id: 'task-1', status: 'finished' })],
      async (task) => { notified.push(task) },
      store,
      [{ evaluate: async () => { throw new Error('detector boom') } }]
    )

    // Should not throw, and still notifies finished task
    await expect(monitor.tick()).resolves.toBeUndefined()
    expect(notified).toHaveLength(1)
  })
})
