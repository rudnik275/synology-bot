import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'
import { migrateJsonSubscriptions } from '../../../../src/infra/migration/subscriptions-migration.ts'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = `/tmp/test-migration-${Date.now()}`

describe('migrateJsonSubscriptions', () => {
  let store: PersistentStore

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    store = new PersistentStore(':memory:')
  })

  afterEach(() => {
    store.close()
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true })
  })

  it('no JSON file → no-op, no error, table stays empty', async () => {
    const jsonPath = join(TMP_DIR, 'data.json')
    await migrateJsonSubscriptions(store, jsonPath)
    expect(store.listSubscriptions()).toHaveLength(0)
  })

  it('JSON file present → entries imported, original renamed .migrated', async () => {
    const jsonPath = join(TMP_DIR, 'data.json')
    const migratedPath = `${jsonPath}.migrated`

    // Old v1.7.8 format: Record<number, TvShowDetailed>
    const oldData = {
      '42': { id: 42, title: 'Breaking Bad', titleOriginal: 'Breaking Bad', episodes: [] },
      '7': { id: 7, title: 'The Wire', titleOriginal: 'The Wire', episodes: [] },
    }
    writeFileSync(jsonPath, JSON.stringify(oldData))

    await migrateJsonSubscriptions(store, jsonPath)

    // Original file renamed to .migrated
    expect(existsSync(jsonPath)).toBe(false)
    expect(existsSync(migratedPath)).toBe(true)

    // Both shows imported
    const subs = store.listSubscriptions()
    expect(subs).toHaveLength(2)
    const ids = subs.map((s) => s.id).sort()
    expect(ids).toContain('42')
    expect(ids).toContain('7')
    const bb = subs.find((s) => s.id === '42')
    expect(bb?.title).toBe('Breaking Bad')
    expect(bb?.showId).toBe(42)
  })

  it('already migrated (table non-empty) → idempotent, no double-import', async () => {
    const jsonPath = join(TMP_DIR, 'data.json')

    // Pre-populate store
    store.addSubscription({ id: 'existing', showId: 99, title: 'Existing' })

    const oldData = { '42': { id: 42, title: 'Breaking Bad', episodes: [] } }
    writeFileSync(jsonPath, JSON.stringify(oldData))

    await migrateJsonSubscriptions(store, jsonPath)

    // Table already had rows → migration is skipped entirely
    const subs = store.listSubscriptions()
    expect(subs).toHaveLength(1)
    expect(subs[0].id).toBe('existing')
    // JSON file left untouched (migration was skipped)
    expect(existsSync(jsonPath)).toBe(true)
  })

  it('re-run after migration (.migrated exists, no .json) → no-op', async () => {
    const jsonPath = join(TMP_DIR, 'data.json')

    // Simulate already-migrated state
    // jsonPath does not exist
    await migrateJsonSubscriptions(store, jsonPath)
    expect(store.listSubscriptions()).toHaveLength(0)
  })
})
