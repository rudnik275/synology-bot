import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'
import { rmSync, existsSync } from 'node:fs'

const TEST_DB = ':memory:'

// --- Cycle 1: KV round-trip ---
describe('PersistentStore', () => {
  let store: PersistentStore

  beforeEach(() => {
    store = new PersistentStore(TEST_DB)
  })

  afterEach(() => {
    store.close()
  })

  it('getKv returns undefined for missing key', () => {
    expect(store.getKv('missing')).toBeUndefined()
  })

  it('setKv and getKv round-trip', () => {
    store.setKv('foo', 'bar')
    expect(store.getKv('foo')).toBe('bar')
  })

  it('setKv overwrites existing value', () => {
    store.setKv('key', 'first')
    store.setKv('key', 'second')
    expect(store.getKv('key')).toBe('second')
  })

  // --- Cycle 2: Migration runner ---
  it('migration runner starts at user_version 0 and bumps to expected version', () => {
    const version = store.getUserVersion()
    expect(version).toBeGreaterThan(0)
  })

  it('migration runner is idempotent — re-running does not throw', () => {
    // Open a second store on the same DB path to simulate re-boot
    // With in-memory DB this tests the same store calling runMigrations twice
    expect(() => store.runMigrations()).not.toThrow()
  })

  // --- Cycle 3: concurrent writes ---
  it('two PersistentStore instances writing different keys both succeed', () => {
    const store2 = new PersistentStore(TEST_DB)
    // WAL mode allows concurrent readers, but bun:sqlite in-memory is single-connection
    // Use a temp file to test real concurrent access
    const tmpDb = `/tmp/test-concurrent-${Date.now()}.db`
    try {
      const a = new PersistentStore(tmpDb)
      const b = new PersistentStore(tmpDb)
      a.setKv('from_a', 'value_a')
      b.setKv('from_b', 'value_b')
      // Both values should be readable from either connection
      expect(a.getKv('from_b')).toBe('value_b')
      expect(b.getKv('from_a')).toBe('value_a')
      a.close()
      b.close()
    } finally {
      if (existsSync(tmpDb)) rmSync(tmpDb)
      if (existsSync(`${tmpDb}-wal`)) rmSync(`${tmpDb}-wal`)
      if (existsSync(`${tmpDb}-shm`)) rmSync(`${tmpDb}-shm`)
      store2.close()
    }
  })

  // notif stubs
  it('wasNotifFired returns false before markNotifFired', () => {
    expect(store.wasNotifFired('task1', 'completed')).toBe(false)
  })

  it('wasNotifFired returns true after markNotifFired', () => {
    store.markNotifFired('task1', 'completed')
    expect(store.wasNotifFired('task1', 'completed')).toBe(true)
  })

  // --- Persistence GC (#300) ---

  it('clearAllNotifFired removes every event for the task, leaves other tasks alone', () => {
    store.markNotifFired('task1', 'finished')
    store.markNotifFired('task1', 'failed')
    store.markNotifFired('task2', 'finished')

    store.clearAllNotifFired('task1')

    expect(store.wasNotifFired('task1', 'finished')).toBe(false)
    expect(store.wasNotifFired('task1', 'failed')).toBe(false)
    expect(store.wasNotifFired('task2', 'finished')).toBe(true)
  })

  it('sweepOrphanNotifDedup removes old orphan rows but keeps rows whose task is still in task_completion', () => {
    store.markNotifFired('orphan', 'finished')
    store.markNotifFired('tracked', 'finished')
    store.insertCompletion('tracked', Date.now())

    // Cutoff in the future → all current rows count as "old"
    store.sweepOrphanNotifDedup(Date.now() + 60_000)

    expect(store.wasNotifFired('orphan', 'finished')).toBe(false)
    expect(store.wasNotifFired('tracked', 'finished')).toBe(true)
  })

  it('sweepOrphanNotifDedup keeps orphan rows newer than the cutoff', () => {
    store.markNotifFired('fresh-orphan', 'finished')

    // Cutoff in the past → nothing is old enough to sweep
    store.sweepOrphanNotifDedup(Date.now() - 60_000)

    expect(store.wasNotifFired('fresh-orphan', 'finished')).toBe(true)
  })
})
