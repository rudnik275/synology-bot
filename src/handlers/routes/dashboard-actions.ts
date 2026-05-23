import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import type { LiveDashboard } from '../flows/live-dashboard.ts'

/** Pending delete confirmations — keyed by "chatId:taskId". */
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()

const CONFIRM_TIMEOUT_MS = 30_000

/**
 * Registers callback handlers for `dash_action:<action>:<taskId>`.
 *
 * Actions:
 *   pause   — pause task; force-refresh dashboard
 *   resume  — resume task; force-refresh dashboard
 *   delete  — first tap → confirm prompt; second tap → delete + refresh
 */
export function registerDashboardActions(
  bot: Bot<Context>,
  synology: SynologyClient,
  dashboard: LiveDashboard
): void {
  bot.callbackQuery(/^dash_action:(pause|resume|delete):(.+)$/, async (ctx) => {
    const [, action, taskId] = ctx.match as RegExpMatchArray
    const chatId = ctx.chat?.id
    if (chatId === undefined) {
      await ctx.answerCallbackQuery()
      return
    }

    if (action === 'pause') {
      await ctx.answerCallbackQuery({ text: 'Приостанавливаю...' })
      const result = await synology.pauseTask(taskId)
      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: `❌ Ошибка: ${result.reason}`, show_alert: true })
        return
      }
      await dashboard.refresh(chatId, ctx)
      return
    }

    if (action === 'resume') {
      await ctx.answerCallbackQuery({ text: 'Возобновляю...' })
      const result = await synology.resumeTask(taskId)
      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: `❌ Ошибка: ${result.reason}`, show_alert: true })
        return
      }
      await dashboard.refresh(chatId, ctx)
      return
    }

    if (action === 'delete') {
      const confirmKey = `${chatId}:${taskId}`

      if (pendingDeletes.has(confirmKey)) {
        // Second tap — confirmed; proceed with delete
        clearTimeout(pendingDeletes.get(confirmKey))
        pendingDeletes.delete(confirmKey)

        await ctx.answerCallbackQuery({ text: 'Удаляю...' })
        const result = await synology.deleteTask(taskId, false)
        if (!result.ok) {
          await ctx.answerCallbackQuery({ text: `❌ Ошибка: ${result.reason}`, show_alert: true })
          return
        }
        await dashboard.refresh(chatId, ctx)
        return
      }

      // First tap — ask for confirmation
      const timer = setTimeout(() => {
        pendingDeletes.delete(confirmKey)
      }, CONFIRM_TIMEOUT_MS)

      pendingDeletes.set(confirmKey, timer)
      await ctx.answerCallbackQuery({
        text: 'Нажмите ещё раз для подтверждения удаления',
        show_alert: true,
      })
      return
    }

    await ctx.answerCallbackQuery()
  })
}
