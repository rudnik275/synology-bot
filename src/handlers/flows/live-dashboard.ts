import type { Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { formatDashboard } from '../../domain/dashboard-formatter.ts'

export interface DashboardEntry {
  messageId: number
  intervalId: ReturnType<typeof setInterval>
  stop: () => void
}

/**
 * LiveDashboard — manages one active dashboard message per chat.
 *
 * Keyed by chatId. Calling start() on an already-active chat stops the previous
 * loop and starts a fresh one on the new message.
 *
 * State is in-memory only — on restart all dashboards are gone (acceptable).
 */
export class LiveDashboard {
  private readonly active = new Map<number, DashboardEntry>()
  private readonly synology: SynologyClient
  private readonly refreshMs: number

  constructor(synology: SynologyClient, refreshMs = 5000) {
    this.synology = synology
    this.refreshMs = refreshMs
  }

  /** Start or replace a dashboard for the given chat. */
  async start(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id
    if (chatId === undefined) return

    // Stop any existing loop for this chat
    this.stop(chatId)

    // Send initial message
    const render = await this.fetchRender()
    const sent = await ctx.api.sendMessage(chatId, render.text, {
      reply_markup: { inline_keyboard: render.keyboard },
    })
    const messageId = sent.message_id

    // Start refresh interval
    const intervalId = setInterval(() => {
      this.refresh(chatId, ctx).catch((err) => {
        console.error(`[LiveDashboard] refresh error for chat ${chatId}:`, err)
      })
    }, this.refreshMs)

    const entry: DashboardEntry = {
      messageId,
      intervalId,
      stop: () => {
        clearInterval(intervalId)
        this.active.delete(chatId)
      },
    }

    this.active.set(chatId, entry)
  }

  /** Stop the dashboard loop for a chat (if any). */
  stop(chatId: number): void {
    const entry = this.active.get(chatId)
    if (entry) {
      entry.stop()
    }
  }

  /** Force-refresh the dashboard message for a chat. Called after actions. */
  async refresh(chatId: number, ctx: Context): Promise<void> {
    const entry = this.active.get(chatId)
    if (!entry) return

    const render = await this.fetchRender()
    try {
      await ctx.api.editMessageText(chatId, entry.messageId, render.text, {
        reply_markup: { inline_keyboard: render.keyboard },
      })
    } catch (err) {
      // Telegram throws if text is unchanged — ignore that specific error
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('message is not modified')) {
        throw err
      }
    }
  }

  /** Whether a dashboard is currently active for a chat. */
  isActive(chatId: number): boolean {
    return this.active.has(chatId)
  }

  /** Get the active message ID for a chat (for tests / actions). */
  getMessageId(chatId: number): number | undefined {
    return this.active.get(chatId)?.messageId
  }

  private async fetchRender() {
    const result = await this.synology.listTasks()
    const tasks = result.ok ? result.data : []
    return formatDashboard(tasks)
  }
}
