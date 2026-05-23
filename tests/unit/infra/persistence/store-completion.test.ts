import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'

describe('PersistentStore — task_completion', () => {
  let store: PersistentStore

  beforeEach(() => {
    store = new PersistentStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('insertCompletion and getCompletedBefore — basic roundtrip', () => {
    const now = Date.now()
    store.insertCompletion('task-1', now)
    // Tasks completed before "now + 1" should include task-1
    const result = store.getCompletedBefore(now + 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('task-1')
  })

  it('insertCompletion is idempotent (OR IGNORE on duplicate)', () => {
    const now = Date.now()
    store.insertCompletion('task-1', now)
    // Second insert should not throw
    expect(() => store.insertCompletion('task-1', now + 1000)).not.toThrow()
  })

  it('getCompletedBefore excludes tasks completed after cutoff', () => {
    const now = Date.now()
    store.insertCompletion('old-task', now - 10000)
    store.insertCompletion('new-task', now)
    const result = store.getCompletedBefore(now - 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('old-task')
  })

  it('getCompletedBefore returns empty array when no completions', () => {
    const result = store.getCompletedBefore(Date.now())
    expect(result).toHaveLength(0)
  })

  it('multiple completions are all returned when within cutoff', () => {
    const now = Date.now()
    store.insertCompletion('t1', now - 3000)
    store.insertCompletion('t2', now - 2000)
    store.insertCompletion('t3', now - 1000)
    const result = store.getCompletedBefore(now + 1)
    expect(result).toHaveLength(3)
    expect(result.sort()).toEqual(['t1', 't2', 't3'])
  })
})
