import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { InlineKeyboard } from 'grammy'

/**
 * Inline keyboard for a stuck/failed task alert.
 * callback_data format: task_action:<action>:<taskId>
 */
export function buildTaskActionKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('▶️ Возобновить', `task_action:resume:${taskId}`)
    .text('⏸ Пауза', `task_action:pause:${taskId}`)
    .text('🗑 Удалить', `task_action:delete:${taskId}`)
}

/**
 * Inline keyboard for the delete confirmation step.
 */
function buildDeleteConfirmKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Да', `task_action:delete_confirm:${taskId}`)
    .text('❌ Отмена', `task_action:delete_cancel:${taskId}`)
}

export interface TaskActionsDeps {
  synology: SynologyClient
  /**
   * Clears a notif-dedup row (event: 'failed' | 'stuck') so a resumed task can
   * re-alert if it errors or sticks again (#301).
   */
  clearNotifFired: (taskId: string, event: string) => void
}

/**
 * Show the outcome of an action on the alert message (#297).
 *
 * For messages older than ~48h Telegram delivers an InaccessibleMessage —
 * `message.text` is undefined and editing would wipe the alert text. In that
 * case reply with a fresh message instead of editing.
 */
async function showOutcome(
  ctx: Context,
  originalText: string | undefined,
  suffix: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  if (originalText === undefined) {
    await ctx.reply(suffix, { reply_markup: replyMarkup })
    return
  }
  await ctx.editMessageText(`${originalText}\n\n${suffix}`, { reply_markup: replyMarkup })
}

const CONFIRM_SUFFIX_RE = /\n\n⚠️ Точно удалить\? \[Да\] \[Отмена\]$/

/**
 * Registers callback_query handlers for task_action:* buttons.
 *
 * Actions:
 *   - resume    → calls synology.resumeTask, clears failure dedups, edits message
 *   - pause     → calls synology.pauseTask, edits message
 *   - delete    → shows confirmation prompt (two-step)
 *   - delete_confirm → actually deletes, edits message
 *   - delete_cancel  → cancels, edits message back
 */
export function registerTaskActionsRoute(bot: Bot<Context>, deps: TaskActionsDeps): void {
  const { synology, clearNotifFired } = deps

  // Resume action
  bot.callbackQuery(/^task_action:resume:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.resumeTask(taskId)
    const originalText = ctx.callbackQuery.message?.text

    if (result.ok) {
      // #301 — drop the 'failed'/'stuck' dedup rows: if the task errors or
      // sticks again after resume, the detectors must alert again.
      clearNotifFired(taskId, 'failed')
      clearNotifFired(taskId, 'stuck')
      await showOutcome(ctx, originalText, '✅ Возобновлено')
    } else {
      await showOutcome(ctx, originalText, `❌ Не удалось: ${result.reason}`)
    }
  })

  // Pause action
  bot.callbackQuery(/^task_action:pause:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.pauseTask(taskId)
    const originalText = ctx.callbackQuery.message?.text

    if (result.ok) {
      await showOutcome(ctx, originalText, '✅ Приостановлено')
    } else {
      await showOutcome(ctx, originalText, `❌ Не удалось: ${result.reason}`)
    }
  })

  // Delete action — first tap: show confirmation
  bot.callbackQuery(/^task_action:delete:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const originalText = ctx.callbackQuery.message?.text
    await showOutcome(
      ctx,
      originalText,
      '⚠️ Точно удалить? [Да] [Отмена]',
      buildDeleteConfirmKeyboard(taskId)
    )
  })

  // Delete confirm — second tap: actually delete
  bot.callbackQuery(/^task_action:delete_confirm:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const result = await synology.deleteTask(taskId)
    // Get the text before the confirmation prompt was appended
    const rawText = ctx.callbackQuery.message?.text
    // Remove the confirmation suffix we added
    const originalText = rawText?.replace(CONFIRM_SUFFIX_RE, '')

    if (result.ok) {
      await showOutcome(ctx, originalText, '✅ Удалено')
    } else {
      await showOutcome(ctx, originalText, `❌ Не удалось: ${result.reason}`)
    }
  })

  // Delete cancel — revert to original message
  bot.callbackQuery(/^task_action:delete_cancel:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1]
    await ctx.answerCallbackQuery()

    const rawText = ctx.callbackQuery.message?.text
    if (rawText === undefined) {
      // Inaccessible (>48h) message — nothing to revert, just confirm cancel.
      await ctx.reply('Отменено')
      return
    }
    const originalText = rawText.replace(CONFIRM_SUFFIX_RE, '')

    await ctx.editMessageText(originalText, {
      reply_markup: buildTaskActionKeyboard(taskId),
    })
  })
}
