import { describe, it, expect, beforeEach } from 'bun:test'
import { TaskMonitor } from '../../../../src/domain/task-monitor/task-monitor.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

// --- Fake store ---
class FakeStore {
  private fired = new Map<string, boolean>()
  private completions = new Map<string, number>()

  wasNotifFired(taskId: string, event: string): boolean {
    return this.fired.get(`${taskId}:${event}`) ?? false
  }

  markNotifFired(taskId: string, event: string): void {
    this.fired.set(`${taskId}:${event}`, true)
  }

  insertCompletion(taskId: string, completedAt: number): void {
    this.completions.set(taskId, completedAt)
  }

  getCompletion(taskId: string): number | undefined {
    return this.completions.get(taskId)
  }

  hasCompletion(taskId: string): boolean {
    return this.completions.has(taskId)
  }
}

function makeTask(id: string, status: Task['status'], title = `Task ${id}`): Task {
  return { id, title, status, size: 1000 }
}

// --- Cycle 1: finished task → notifier called once ---
describe('TaskMonitor', () => {
  let store: FakeStore
  let notified: Task[]
  let monitor: TaskMonitor

  beforeEach(() => {
    store = new FakeStore()
    notified = []
    monitor = new TaskMonitor(
      async () => [],
      async (task) => { notified.push(task) },
      store as any
    )
  })

  it('finished task triggers notify and marks dedup', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'finished')])
    await monitor.tick()
    expect(notified).toHaveLength(1)
    expect(notified[0].id).toBe('t1')
    expect(store.wasNotifFired('t1', 'finished')).toBe(true)
  })

  it('seeding status is also treated as finished', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'seeding')])
    await monitor.tick()
    expect(notified).toHaveLength(1)
    expect(notified[0].id).toBe('t1')
    expect(store.wasNotifFired('t1', 'finished')).toBe(true)
  })

  it('second poll does NOT re-notify for same finished task', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'finished')])
    await monitor.tick()
    await monitor.tick()
    expect(notified).toHaveLength(1)
  })

  it('non-finished task does NOT trigger notify', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'downloading')])
    await monitor.tick()
    expect(notified).toHaveLength(0)
  })

  it('two finished tasks triggers notify twice', async () => {
    monitor.setGetTasks(async () => [
      makeTask('t1', 'finished'),
      makeTask('t2', 'finished'),
    ])
    await monitor.tick()
    expect(notified).toHaveLength(2)
    expect(notified.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('already-dedup task (pre-existing in store) does not get re-notified', async () => {
    // Simulate bot restart — mark as fired before monitor sees the task
    store.markNotifFired('t1', 'finished')
    monitor.setGetTasks(async () => [makeTask('t1', 'finished')])
    await monitor.tick()
    expect(notified).toHaveLength(0)
  })

  it('inserts task_completion row when task finishes', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'finished')])
    await monitor.tick()
    expect(store.hasCompletion('t1')).toBe(true)
  })

  it('does NOT insert completion row for non-finished task', async () => {
    monitor.setGetTasks(async () => [makeTask('t1', 'waiting')])
    await monitor.tick()
    expect(store.hasCompletion('t1')).toBe(false)
  })

  it('error in getTasks does not throw (crash-safe tick)', async () => {
    monitor.setGetTasks(async () => { throw new Error('Network error') })
    await expect(monitor.tick()).resolves.toBeUndefined()
  })
})
