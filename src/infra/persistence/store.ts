import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrations.ts'
import type { NasState } from '../../domain/reachability-monitor.ts'
import type { Subscription } from '../../domain/subscription.ts'

/**
 * A stashed add-intake (#99, generalized #120): the bot stashes either the
 * BYTES of a forwarded `.torrent` or a magnet/URL string, and the Mini App
 * fetches it by token to resume the wizard at the folder step.
 */
export type AddIntakeStash =
  | { kind: 'bytes'; fileName: string; data: Uint8Array }
  | { kind: 'uri'; uri: string }

export class PersistentStore {
  private db: Database

  constructor(dbPath: string = './data/bot.db') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath, { create: true })
    // WAL mode for concurrent access
    this.db.run('PRAGMA journal_mode=WAL')
    this.runMigrations()
  }

  runMigrations(): void {
    runMigrations(this.db)
  }

  getUserVersion(): number {
    return (this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version
  }

  getKv(key: string): string | undefined {
    const row = this.db.query<{ value: string }, [string]>(
      'SELECT value FROM kv WHERE key = ?'
    ).get(key)
    return row?.value
  }

  setKv(key: string, value: string): void {
    this.db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value])
  }

  // --- NAS reachability state ---

  getNasState(): NasState {
    const value = this.getKv('nas_state')
    return value === 'unreachable' ? 'unreachable' : 'reachable'
  }

  setNasState(state: NasState): void {
    this.setKv('nas_state', state)
  }

  // --- Health dedup ---

  markHealthFired(event: string, resourceId: string): void {
    this.db.run(
      'INSERT OR REPLACE INTO health_dedup (event, resource_id, fired_at) VALUES (?, ?, ?)',
      [event, resourceId, Date.now()]
    )
  }

  clearHealthFired(event: string, resourceId: string): void {
    this.db.run(
      'DELETE FROM health_dedup WHERE event = ? AND resource_id = ?',
      [event, resourceId]
    )
  }

  wasHealthFired(event: string, resourceId: string): boolean {
    const row = this.db.query<{ event: string }, [string, string]>(
      'SELECT event FROM health_dedup WHERE event = ? AND resource_id = ?'
    ).get(event, resourceId)
    return row !== null
  }

  // --- Notification dedup ---

  markNotifFired(taskId: string, event: string): void {
    this.db.run(
      'INSERT OR REPLACE INTO notif_dedup (task_id, event, fired_at) VALUES (?, ?, ?)',
      [taskId, event, Date.now()]
    )
  }

  wasNotifFired(taskId: string, event: string): boolean {
    const row = this.db.query<{ task_id: string }, [string, string]>(
      'SELECT task_id FROM notif_dedup WHERE task_id = ? AND event = ?'
    ).get(taskId, event)
    return row !== null
  }

  clearNotifFired(taskId: string, event: string): void {
    this.db.run(
      'DELETE FROM notif_dedup WHERE task_id = ? AND event = ?',
      [taskId, event]
    )
  }

  insertCompletion(taskId: string, completedAt: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO task_completion (task_id, completed_at) VALUES (?, ?)',
      [taskId, completedAt]
    )
  }

  getCompletedBefore(cutoffMs: number): string[] {
    const rows = this.db.query<{ task_id: string }, [number]>(
      'SELECT task_id FROM task_completion WHERE completed_at < ?'
    ).all(cutoffMs)
    return rows.map((r) => r.task_id)
  }

  // --- Subscription helpers ---

  listSubscriptions(): Subscription[] {
    const rows = this.db.query<{ data: string }, []>(
      'SELECT data FROM subscriptions'
    ).all()
    return rows.map((r) => JSON.parse(r.data) as Subscription)
  }

  addSubscription(s: Subscription): void {
    this.db.run(
      'INSERT OR REPLACE INTO subscriptions (id, data) VALUES (?, ?)',
      [s.id, JSON.stringify(s)]
    )
  }

  removeSubscription(id: string): void {
    this.db.run('DELETE FROM subscriptions WHERE id = ?', [id])
  }

  getSubscription(id: string): Subscription | undefined {
    const row = this.db.query<{ data: string }, [string]>(
      'SELECT data FROM subscriptions WHERE id = ?'
    ).get(id)
    return row ? (JSON.parse(row.data) as Subscription) : undefined
  }

  // --- Task completion (for AutoCleaner #18) ---

  removeCompletion(taskId: string): void {
    this.db.run('DELETE FROM task_completion WHERE task_id = ?', [taskId])
  }

  // --- DeployWatcher dedup (#54) ---

  getKvNumber(key: string): number | undefined {
    const v = this.getKv(key)
    return v ? Number(v) : undefined
  }

  setKvNumber(key: string, value: number): void {
    this.setKv(key, String(value))
  }

  // --- Add-intake stash (#99, generalized #120): short-lived handoff bot → Mini App ---
  //
  // Holds either file BYTES (a .torrent forwarded as a document, #99) or a URI
  // string (a magnet / http(s) URL sent as text, #120). One token, one of the
  // two payload kinds. The Mini App fetches it by token and resumes the wizard
  // at the folder step.

  /** Stash a .torrent payload under `token`, expiring `ttlMs` from now. */
  stashTorrent(token: string, fileName: string, data: Uint8Array, ttlMs: number): void {
    this.db.run(
      'INSERT OR REPLACE INTO torrent_stash (token, file_name, data, uri, expires_at) VALUES (?, ?, ?, NULL, ?)',
      [token, fileName, data, Date.now() + ttlMs]
    )
  }

  /** Stash a magnet / URL string under `token`, expiring `ttlMs` from now (#120). */
  stashUri(token: string, uri: string, ttlMs: number): void {
    this.db.run(
      'INSERT OR REPLACE INTO torrent_stash (token, file_name, data, uri, expires_at) VALUES (?, NULL, NULL, ?, ?)',
      [token, uri, Date.now() + ttlMs]
    )
  }

  /**
   * Fetch a stashed add-intake by token; prunes and returns undefined if
   * expired. Returns a discriminated payload: `{ kind: 'bytes', fileName, data }`
   * for a .torrent (#99) or `{ kind: 'uri', uri }` for a magnet/URL (#120).
   */
  getTorrentStash(token: string): AddIntakeStash | undefined {
    const row = this.db
      .query<
        { file_name: string | null; data: Uint8Array | null; uri: string | null; expires_at: number },
        [string]
      >('SELECT file_name, data, uri, expires_at FROM torrent_stash WHERE token = ?')
      .get(token)
    if (!row) return undefined
    if (row.expires_at <= Date.now()) {
      this.deleteTorrentStash(token)
      return undefined
    }
    if (row.uri !== null) {
      return { kind: 'uri', uri: row.uri }
    }
    return {
      kind: 'bytes',
      fileName: row.file_name ?? 'download.torrent',
      data: row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data ?? []),
    }
  }

  deleteTorrentStash(token: string): void {
    this.db.run('DELETE FROM torrent_stash WHERE token = ?', [token])
  }

  /** Opportunistic cleanup of expired stashes. */
  pruneExpiredStashes(): void {
    this.db.run('DELETE FROM torrent_stash WHERE expires_at <= ?', [Date.now()])
  }

  close(): void {
    this.db.close()
  }
}
