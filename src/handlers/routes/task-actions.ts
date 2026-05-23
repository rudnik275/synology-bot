import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { InlineKeyboard } from 'grammy'

/**
 * Inline keyboard for a stuck/failed task alert.
 * callback_data format: task_action:<action>:<taskId>
 */
export function buildTaskActionKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('▶️ Resume', `task_action:resume:${taskId}`)
    .text('⏸ Pause', `task_action:pause:${taskId}`)
    .text('🗑 Delete', `task_action:delete:${taskId}`)
}

/**
 * Inline keyboard for the delete confirmation step.
 */
function buildDeleteConfirmKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Да', `task_action:delete_confirm:${taskId}`)
    .text('❌ Отмена', `task_action:delete_cancel:${taskId}`)
}

/**
 * Registers callback_query handlers for task_action:* buttons.
 *
 * Actions:
 *   - resume    → calls synology.resumeTask, edits message
 *   - pause     → calls synology.pauseTask, edits message
 *   - delete    → shows confirmation prompt (two-step)
 *   - delete_confirm → actually deletes, edits message
 *   - delete_cancel  → cancels, edits message back
 */
export function registerTaskActionsRoute(bot: Bot<Context>, synology: SynologyClient): void {
  // Resume action
  bot.callbackQuery(/^task_action:resume:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.resumeTask(taskId)
    const originalText = ctx.callbackQuery.message?.text ?? ''

    if (result.ok) {
      await ctx.editMessageText(`${originalText}\n\n✅ Возобновлено`, {
        reply_markup: undefined,
      })
    } else {
      await ctx.editMessageText(`${originalText}\n\n❌ Не удалось: ${result.reason}`, {
        reply_markup: undefined,
      })
    }
  })

  // Pause action
  bot.callbackQuery(/^task_action:pause:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.pauseTask(taskId)
    const originalText = ctx.callbackQuery.message?.text ?? ''

    if (result.ok) {
      await ctx.editMessageText(`${originalText}\n\n✅ Приостановлено`, {
        reply_markup: undefined,
      })
    } else {
      await ctx.editMessageText(`${originalText}\n\n❌ Не удалось: ${result.reason}`, {
        reply_markup: undefined,
      })
    }
  })

  // Delete action — first tap: show confirmation
  bot.callbackQuery(/^task_action:delete:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const originalText = ctx.callbackQuery.message?.text ?? ''
    await ctx.editMessageText(
      `${originalText}\n\n⚠️ Точно удалить? [Да] [Отмена]`,
      { reply_markup: buildDeleteConfirmKeyboard(taskId) }
    )
  })

  // Delete confirm — second tap: actually delete
  bot.callbackQuery(/^task_action:delete_confirm:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.deleteTask(taskId)
    // Get the text before the confirmation prompt was appended
    const rawText = ctx.callbackQuery.message?.text ?? ''
    // Remove the confirmation suffix we added
    const originalText = rawText.replace(/\n\n⚠️ Точно удалить\? \[Да\] \[Отмена\]$/, '')

    if (result.ok) {
      await ctx.editMessageText(`${originalText}\n\n✅ Удалено`, {
        reply_markup: undefined,
      })
    } else {
      await ctx.editMessageText(`${originalText}\n\n❌ Не удалось: ${result.reason}`, {
        reply_markup: undefined,
      })
    }
  })

  // Delete cancel — revert to original message
  bot.callbackQuery(/^task_action:delete_cancel:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const rawText = ctx.callbackQuery.message?.text ?? ''
    const originalText = rawText.replace(/\n\n⚠️ Точно удалить\? \[Да\] \[Отмена\]$/, '')

    await ctx.editMessageText(originalText, {
      reply_markup: buildTaskActionKeyboard(taskId),
    })
  })
}
