import type { Task } from '../infra/synology/types.ts'
import type { TaskDetector } from './task-monitor/task-monitor.ts'
import { cleanReleaseTitle } from './clean-release-title.ts'

export interface StuckDetectorStore {
  wasNotifFired(taskId: string, event: string): boolean
  markNotifFired(taskId: string, event: string): void
  clearNotifFired(taskId: string, event: string): void
}

export interface StuckAlertOptions {
  text: string
  taskId: string
}

export type SendStuckAlertFn = (opts: StuckAlertOptions) => Promise<void>

export interface StuckDetectorDeps {
  zeroSpeedThresholdMs: number
  store: StuckDetectorStore
  sendAlert: SendStuckAlertFn
  now?: () => number
}

/**
 * StuckDetector — pure domain logic that detects tasks stuck at speed=0
 * for >= zeroSpeedThresholdMs (default 5 minutes) while in downloading status.
 *
 * Tracks per-task zero-speed start time in memory. Deduplicates alerts
 * via the store's notif_dedup table using event key 'stuck'.
 */
export class StuckDetector implements TaskDetector {
  private zeroSpeedThresholdMs: number
  private store: StuckDetectorStore
  private sendAlert: SendStuckAlertFn
  private now: () => number

  /** taskId → timestamp when zero-speed was first observed */
  private zeroSpeedSince: Map<string, number> = new Map()

  constructor(deps: StuckDetectorDeps) {
    this.zeroSpeedThresholdMs = deps.zeroSpeedThresholdMs
    this.store = deps.store
    this.sendAlert = deps.sendAlert
    this.now = deps.now ?? (() => Date.now())
  }

  async evaluate(tasks: Task[]): Promise<void> {
    const seenIds = new Set<string>()

    for (const task of tasks) {
      seenIds.add(task.id)

      const speed = task.additional?.transfer?.speed_download ?? 0

      if (task.status === 'downloading' && speed === 0) {
        const now = this.now()

        if (!this.zeroSpeedSince.has(task.id)) {
          // First observation of zero speed — start timer
          this.zeroSpeedSince.set(task.id, now)
          continue
        }

        const since = this.zeroSpeedSince.get(task.id)!
        const elapsed = now - since

        if (elapsed >= this.zeroSpeedThresholdMs) {
          if (!this.store.wasNotifFired(task.id, 'stuck')) {
            await this.sendAlert({
              text: `⏸ Зависло: ${cleanReleaseTitle(task.title).title}\nСкорость 0 уже 5 мин`,
              taskId: task.id,
            })
            this.store.markNotifFired(task.id, 'stuck')
          }
        }
      } else {
        // Speed is non-zero OR status changed away from downloading — clear timer and dedup
        if (this.zeroSpeedSince.has(task.id)) {
          this.zeroSpeedSince.delete(task.id)
          this.store.clearNotifFired(task.id, 'stuck')
        }
      }
    }

    // Clean up timers for tasks no longer in the list
    for (const taskId of this.zeroSpeedSince.keys()) {
      if (!seenIds.has(taskId)) {
        this.zeroSpeedSince.delete(taskId)
        this.store.clearNotifFired(taskId, 'stuck')
      }
    }
  }
}
