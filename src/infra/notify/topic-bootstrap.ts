import type { Bot, Context } from 'grammy'
import { GrammyError } from 'grammy'
import { CATEGORIES, type Category } from './categories.ts'

export interface TopicBootstrapStore {
  getTopicThreadId(category: Category): number | undefined
  setTopicThreadId(category: Category, threadId: number): void
  areTopicsDisabled(): boolean
  setTopicsDisabled(): void
}

export interface BootstrapResult {
  created: Category[]
  skipped: Category[]
  disabled: boolean
}

/**
 * Create any missing private-chat forum topics for the owner.
 *
 * Idempotent: if a category already has a thread_id stored, it's skipped.
 * If createForumTopic fails (older client, BotFather has it disabled, or
 * any 4xx), we set topics_disabled and bail — subsequent notifications go
 * to the flat private chat. We don't keep retrying; the owner can clear
 * the flag manually after upgrading their client.
 */
export async function bootstrapTopics(
  bot: Bot<Context>,
  ownerChatId: number,
  store: TopicBootstrapStore
): Promise<BootstrapResult> {
  const result: BootstrapResult = { created: [], skipped: [], disabled: false }

  if (store.areTopicsDisabled()) {
    result.disabled = true
    return result
  }

  for (const cat of CATEGORIES) {
    if (store.getTopicThreadId(cat.key) !== undefined) {
      result.skipped.push(cat.key)
      continue
    }

    try {
      const topic = await bot.api.createForumTopic(ownerChatId, cat.name, {
        icon_color: cat.iconColor,
      })
      store.setTopicThreadId(cat.key, topic.message_thread_id)
      result.created.push(cat.key)
      console.log(`[topics] Created '${cat.name}' → message_thread_id ${topic.message_thread_id}`)
    } catch (err) {
      // 400-class errors mean topics aren't allowed for this chat — give up
      // and route everything to the flat chat from now on.
      const isClientError = err instanceof GrammyError && err.error_code >= 400 && err.error_code < 500
      if (isClientError) {
        console.warn(
          `[topics] Telegram refused createForumTopic (${err.error_code} ${err.description}). ` +
            `Topics disabled; routing to flat private chat.`
        )
        store.setTopicsDisabled()
        result.disabled = true
        return result
      }
      // Network / 5xx — re-throw so caller (startup) sees it and can retry.
      throw err
    }
  }

  return result
}
