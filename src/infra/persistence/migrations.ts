import type { Database } from 'bun:sqlite'

export interface Migration {
  version: number
  up: (db: Database) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`)
      db.run(`CREATE TABLE IF NOT EXISTS notif_dedup (
        task_id TEXT,
        event TEXT,
        fired_at INTEGER,
        PRIMARY KEY (task_id, event)
      )`)
      db.run(`CREATE TABLE IF NOT EXISTS health_dedup (
        event TEXT,
        resource_id TEXT,
        fired_at INTEGER,
        PRIMARY KEY (event, resource_id)
      )`)
      db.run(`CREATE TABLE IF NOT EXISTS task_completion (
        task_id TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL
      )`)
      db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )`)
    },
  },
  {
    // #99 — short-lived stash for .torrent files forwarded to the bot, handed
    // to the Mini App by token via a deep-link. Binary payload + own expiry, so
    // it gets a dedicated table rather than the TEXT-only kv store.
    version: 2,
    up: (db) => {
      db.run(`CREATE TABLE IF NOT EXISTS torrent_stash (
        token TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        data BLOB NOT NULL,
        expires_at INTEGER NOT NULL
      )`)
    },
  },
  {
    // #120 — generalize the stash to an add-intake stash that holds either file
    // BYTES (.torrent, #99) or a URI string (magnet / http(s) URL handed off
    // from a bot text message). A magnet link can exceed the 512-char
    // `start_param` limit, so it is stashed too, not carried inline.
    //
    // SQLite can't drop the existing NOT NULL constraint on `data` in place, so
    // recreate the table: `data` and `file_name` become nullable (a URI stash
    // has neither), and a `uri` column is added. Existing rows (bytes stashes)
    // carry over; the in-flight TTL is short, so any loss on upgrade is benign.
    version: 3,
    up: (db) => {
      db.run('ALTER TABLE torrent_stash RENAME TO torrent_stash_v2')
      db.run(`CREATE TABLE torrent_stash (
        token TEXT PRIMARY KEY,
        file_name TEXT,
        data BLOB,
        uri TEXT,
        expires_at INTEGER NOT NULL
      )`)
      db.run(
        'INSERT INTO torrent_stash (token, file_name, data, uri, expires_at) ' +
          'SELECT token, file_name, data, NULL, expires_at FROM torrent_stash_v2'
      )
      db.run('DROP TABLE torrent_stash_v2')
    },
  },
]

export function runMigrations(db: Database): void {
  const currentVersion = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion)
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db)
      db.run(`PRAGMA user_version = ${migration.version}`)
    })()
  }
}
