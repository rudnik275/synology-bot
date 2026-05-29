import type { InlineKeyboard } from 'grammy'
import type { Task } from '../../infra/synology/types.ts'
import type { OwnerNotifier } from '../../infra/notify/owner-notifier.ts'

/**
 * Notifier — domain-aware formatter for finished Download Task events.
 *
 * It owns *what* the message looks like (the ✅ prefix, the Папка line,
 * the "...и ещё N" tail). Where it goes (chat id, topic thread id, fallback)
 * is the OwnerNotifier's job.
 */
export class Notifier {
  /**
   * @param owner       the single owner-bound send surface.
   * @param openButton  optional factory for the "Открыть" deep-link button
   *                    (downloads tab). Returns `undefined` when MINIAPP_URL is
   *                    unset, so finished pushes stay button-less — unchanged
   *                    behavior when the Mini App is not configured.
   */
  constructor(
    private readonly owner: OwnerNotifier,
    private readonly openButton?: () => InlineKeyboard | undefined
  ) {}

  /** Build and send the "finished" push for a single task. */
  async notify(task: Task): Promise<void> {
    const lines = [`✅ Скачано: ${task.title}`]
    const destination = task.additional?.detail?.destination
    if (destination) lines.push(`Папка: ${destination}`)
    await this.owner.send('torrents', lines.join('\n'), { replyMarkup: this.openButton?.() })
  }

  /**
   * Send a single grouped "finished" push for multiple tasks.
   * Format: "✅ Скачано (<N>):\n• <title1>\n..."
   * Truncates to 10 entries; if more, appends "...и ещё <K>".
   */
  async notifyFinishedGrouped(tasks: Task[]): Promise<void> {
    const maxDisplay = 10
    const displayed = tasks.slice(0, maxDisplay)
    const remaining = tasks.length - displayed.length

    const lines = [`✅ Скачано (${tasks.length}):`]
    for (const task of displayed) lines.push(`• ${task.title}`)
    if (remaining > 0) lines.push(`...и ещё ${remaining}`)

    await this.owner.send('torrents', lines.join('\n'), { replyMarkup: this.openButton?.() })
  }

  /** Returns a bound function suitable for passing to TaskMonitor. */
  asCallback(): (task: Task) => Promise<void> {
    return (task) => this.notify(task)
  }
}
