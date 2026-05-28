import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrations.ts'
import type { NasState } from '../../domain/reachability-monitor.ts'
import type { Subscription } from '../../domain/subscription.ts'

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

  close(): void {
    this.db.close()
  }
}
