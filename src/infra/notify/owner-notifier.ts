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
  replyMarkup?: InlineKeyboardMarkup
}) => Promise<void>

export interface SendOptions {
  replyMarkup?: InlineKeyboardMarkup
}

/**
 * OwnerNotifier — the single place that knows where push messages go.
 *
 * Callers tag each message with a *category* ('torrents', 'health', 'deploy',
 * 'subscriptions') for log context; every message is sent to the owner's flat
 * private chat. (Per-category forum-topic routing was removed in ADR 0005.)
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
      replyMarkup: opts.replyMarkup,
    })
  }
}
