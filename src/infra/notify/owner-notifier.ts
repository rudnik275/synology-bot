import type { InlineKeyboardMarkup } from 'grammy/types'
import type { Category } from './categories.ts'

/** Minimal store shape needed by OwnerNotifier — kept narrow for testing. */
export interface OwnerNotifierStore {
  getKv(key: string): string | undefined
}

/**
 * Low-level send primitive — single seam between OwnerNotifier and grammy.
 * Tests pass a fake; production passes a thin wrapper around bot.api.sendMessage.
 */
export type LowLevelSend = (params: {
  chatId: number
  text: string
  messageThreadId?: number
  replyMarkup?: InlineKeyboardMarkup
}) => Promise<void>

export interface SendOptions {
  replyMarkup?: InlineKeyboardMarkup
}

export const TOPIC_THREAD_KEY_PREFIX = 'topic_thread_id:'
export const TOPICS_DISABLED_KEY = 'topics_disabled'

/**
 * OwnerNotifier — the single place that knows where messages go.
 *
 * Callers say which *category* a message belongs to ('torrents', 'health',
 * 'deploy', 'subscriptions'); this class resolves owner_chat_id and the
 * per-category message_thread_id from KV, then sends. When topics are
 * disabled (older Telegram client, BotFather setting), it silently routes
 * to the flat private chat.
 *
 * Centralizing this kills five copies of the same "if (!owner_chat_id)
 * return; sendMessage(...)" snippet that used to live in app.ts.
 */
export class OwnerNotifier {
  constructor(
    private readonly store: OwnerNotifierStore,
    private readonly lowLevel: LowLevelSend
  ) {}

  async send(category: Category, text: string, opts: SendOptions = {}): Promise<void> {
    const chatIdStr = this.store.getKv('owner_chat_id')
    if (!chatIdStr) {
      console.warn(`[OwnerNotifier] owner_chat_id not set — dropping ${category} message`)
      return
    }
    await this.lowLevel({
      chatId: Number(chatIdStr),
      text,
      messageThreadId: this.resolveThreadId(category),
      replyMarkup: opts.replyMarkup,
    })
  }

  private resolveThreadId(category: Category): number | undefined {
    if (this.store.getKv(TOPICS_DISABLED_KEY) === '1') return undefined
    const value = this.store.getKv(`${TOPIC_THREAD_KEY_PREFIX}${category}`)
    return value ? Number(value) : undefined
  }
}
