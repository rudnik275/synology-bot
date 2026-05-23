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
