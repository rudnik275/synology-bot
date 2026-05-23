import type { Task } from '../../infra/synology/types.ts'

/** Minimal store interface required by Notifier (for testability) */
export interface NotifierStore {
  getKv(key: string): string | undefined
}

/** Sender function — injectable so tests can fake it without real grammy */
export type SendMessageFn = (chatId: number, text: string) => Promise<void>

/**
 * Notifier — subscribes to TaskMonitor's "finished" events and sends a push
 * to the owner via Telegram. Reads owner_chat_id from PersistentStore.
 */
export class Notifier {
  private store: NotifierStore
  private send: SendMessageFn

  constructor(store: NotifierStore, send: SendMessageFn) {
    this.store = store
    this.send = send
  }

  /**
   * Build and send the "finished" push to the owner.
   * No-op (with warning) if owner_chat_id is not set.
   */
  async notify(task: Task): Promise<void> {
    const ownerChatIdStr = this.store.getKv('owner_chat_id')
    if (!ownerChatIdStr) {
      console.warn('[Notifier] owner_chat_id not set — skipping push for task', task.id)
      return
    }

    const chatId = Number(ownerChatIdStr)
    const destination = task.additional?.detail?.destination
    const lines = [`✅ Скачано: ${task.title}`]
    if (destination) {
      lines.push(`Папка: ${destination}`)
    }
    const text = lines.join('\n')

    await this.send(chatId, text)
  }

  /**
   * Returns a bound function suitable for passing to TaskMonitor as the notify callback.
   */
  asCallback(): (task: Task) => Promise<void> {
    return (task) => this.notify(task)
  }
}
