import type { Task } from '../infra/synology/types.ts'
import type { TaskDetector } from './task-monitor/task-monitor.ts'
import { cleanReleaseTitle } from './clean-release-title.ts'

export interface FailedDetectorStore {
  wasNotifFired(taskId: string, event: string): boolean
  markNotifFired(taskId: string, event: string): void
}

export interface FailedAlertOptions {
  text: string
  taskId: string
}

export type SendFailedAlertFn = (opts: FailedAlertOptions) => Promise<void>

export interface FailedDetectorDeps {
  store: FailedDetectorStore
  sendAlert: SendFailedAlertFn
}

/**
 * FailedDetector — pure domain logic that fires a single alert when a task
 * transitions to status 'error'. Deduplicates via notif_dedup event key 'failed'.
 */
export class FailedDetector implements TaskDetector {
  private store: FailedDetectorStore
  private sendAlert: SendFailedAlertFn

  constructor(deps: FailedDetectorDeps) {
    this.store = deps.store
    this.sendAlert = deps.sendAlert
  }

  async evaluate(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      if (task.status !== 'error') continue
      if (this.store.wasNotifFired(task.id, 'failed')) continue

      await this.sendAlert({
        text: `❌ Ошибка: ${cleanReleaseTitle(task.title).title}\nСтатус: error`,
        taskId: task.id,
      })
      this.store.markNotifFired(task.id, 'failed')
    }
  }
}
