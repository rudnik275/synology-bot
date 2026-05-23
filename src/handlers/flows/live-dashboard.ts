import type { Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { formatDashboard } from '../../domain/dashboard-formatter.ts'

export interface DashboardEntry {
  messageId: number
  intervalId: ReturnType<typeof setInterval>
  autoStopTimer: ReturnType<typeof setTimeout>
  /** ctx captured from most recent start() — api is bot-level so stays valid */
  ctx: Context
  stop: () => void
}

/**
 * LiveDashboard — manages one active dashboard message per chat.
 *
 * Keyed by chatId. Calling start() on an already-active chat stops the previous
 * loop and starts a fresh one on the new message.
 *
 * Auto-stop: after autoStopMs of inactivity (no button taps), the dashboard
 * freezes — the refresh loop stops and the message is edited to show a stopped
 * footer with a single "🔄 Refresh" button. The timer resets on each
 * extendLifetime() call (pause/resume/delete/refresh taps).
 *
 * State is in-memory only — on restart all dashboards are gone (acceptable).
 */
export class LiveDashboard {
  private readonly active = new Map<number, DashboardEntry>()
  private readonly synology: SynologyClient
  private readonly refreshMs: number
  private readonly autoStopMs: number

  constructor(synology: SynologyClient, refreshMs = 5000, autoStopMs = 120_000) {
    this.synology = synology
    this.refreshMs = refreshMs
    this.autoStopMs = autoStopMs
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

    // Schedule auto-stop timer
    const autoStopTimer = setTimeout(() => {
      this.autoStop(chatId).catch((err) => {
        console.error(`[LiveDashboard] autoStop error for chat ${chatId}:`, err)
      })
    }, this.autoStopMs)

    // Start refresh interval
    const intervalId = setInterval(() => {
      this.refresh(chatId, ctx).catch((err) => {
        console.error(`[LiveDashboard] refresh error for chat ${chatId}:`, err)
      })
    }, this.refreshMs)

    const entry: DashboardEntry = {
      messageId,
      intervalId,
      autoStopTimer,
      ctx,
      stop: () => {
        clearInterval(intervalId)
        clearTimeout(autoStopTimer)
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

  /**
   * Extend the auto-stop lifetime for a chat.
   * Called by action handlers (pause/resume/delete/refresh) to reset the inactivity timer.
   */
  extendLifetime(chatId: number): void {
    const entry = this.active.get(chatId)
    if (!entry) return

    // Cancel the existing timer and schedule a fresh one
    clearTimeout(entry.autoStopTimer)

    entry.autoStopTimer = setTimeout(() => {
      this.autoStop(chatId).catch((err) => {
        console.error(`[LiveDashboard] autoStop error for chat ${chatId}:`, err)
      })
    }, this.autoStopMs)
  }

  /** Whether a dashboard is currently active for a chat. */
  isActive(chatId: number): boolean {
    return this.active.has(chatId)
  }

  /** Get the active message ID for a chat (for tests / actions). */
  getMessageId(chatId: number): number | undefined {
    return this.active.get(chatId)?.messageId
  }

  /**
   * Freeze the dashboard: stop refresh loop, edit message to stopped state
   * (stopped footer + single Refresh button).
   */
  private async autoStop(chatId: number): Promise<void> {
    const entry = this.active.get(chatId)
    if (!entry) return

    // Clear the refresh interval and remove from active map
    clearInterval(entry.intervalId)
    this.active.delete(chatId)

    // Edit the message one last time to show stopped state
    const render = await this.fetchRender({ stopped: true })
    try {
      await entry.ctx.api.editMessageText(chatId, entry.messageId, render.text, {
        reply_markup: { inline_keyboard: render.keyboard },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('message is not modified')) {
        console.error(`[LiveDashboard] autoStop editMessageText error for chat ${chatId}:`, err)
      }
    }
  }

  private async fetchRender(options?: { stopped?: boolean }) {
    const result = await this.synology.listTasks()
    const tasks = result.ok ? result.data : []
    return formatDashboard(tasks, options)
  }
}
