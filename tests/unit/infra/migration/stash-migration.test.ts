// #120 — the v2→v3 migration generalizes torrent_stash from "bytes only" to
// "bytes OR uri": `data`/`file_name` become nullable and a `uri` column is
// added. This test builds a v2-shaped table directly, runs the migration set,
// and asserts (a) an existing bytes row survives and (b) the upgraded table
// accepts a URI-only row.
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from '../../../../src/infra/persistence/migrations.ts'

/** Build a database stopped at schema version 2 (the #99 bytes-only stash). */
function v2Database(): Database {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE torrent_stash (
    token TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    data BLOB NOT NULL,
    expires_at INTEGER NOT NULL
  )`)
  db.run('PRAGMA user_version = 2')
  return db
}

describe('torrent_stash v2→v3 migration (#120)', () => {
  it('carries existing bytes rows across the upgrade', () => {
    const db = v2Database()
    const bytes = new Uint8Array([0x64, 0x38, 0x3a]) // "d8:"
    db.run('INSERT INTO torrent_stash (token, file_name, data, expires_at) VALUES (?, ?, ?, ?)', [
      'legacy',
      'old.torrent',
      bytes,
      Date.now() + 60_000,
    ])

    runMigrations(db)

    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBeGreaterThanOrEqual(3)
    const row = db
      .query<{ file_name: string; data: Uint8Array; uri: string | null }, [string]>(
        'SELECT file_name, data, uri FROM torrent_stash WHERE token = ?'
      )
      .get('legacy')
    expect(row).not.toBeNull()
    expect(row!.file_name).toBe('old.torrent')
    expect(Array.from(row!.data)).toEqual(Array.from(bytes))
    expect(row!.uri).toBeNull()
  })

  it('the upgraded table accepts a URI-only row (no file_name / data)', () => {
    const db = v2Database()
    runMigrations(db)

    const magnet = 'magnet:?xt=urn:btih:def456'
    db.run('INSERT INTO torrent_stash (token, file_name, data, uri, expires_at) VALUES (?, NULL, NULL, ?, ?)', [
      'uri-row',
      magnet,
      Date.now() + 60_000,
    ])

    const row = db
      .query<{ file_name: string | null; data: Uint8Array | null; uri: string }, [string]>(
        'SELECT file_name, data, uri FROM torrent_stash WHERE token = ?'
      )
      .get('uri-row')
    expect(row!.uri).toBe(magnet)
    expect(row!.file_name).toBeNull()
    expect(row!.data).toBeNull()
  })
})
