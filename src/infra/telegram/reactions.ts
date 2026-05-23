import type { Context } from 'grammy'
import type { ReactionTypeEmoji } from '@grammyjs/types'

/**
 * Semantic reaction types for the magnet flow.
 * Maps to the closest supported Telegram Bot API emojis.
 */
export type Reaction = 'pending' | 'success' | 'error'

type SupportedEmoji = ReactionTypeEmoji['emoji']

const REACTION_EMOJI: Record<Reaction, SupportedEmoji> = {
  pending: '🤔',
  success: '👍',
  error: '👎',
}

const REACTION_FALLBACK_TEXT: Record<Reaction, string> = {
  pending: 'Обрабатывается...',
  success: 'Готово.',
  error: 'Ошибка.',
}

/**
 * Sets a semantic reaction on the current message.
 * Falls back to a text reply if the Telegram Bot API rejects the reaction.
 */
export async function setReaction(ctx: Context, reaction: Reaction): Promise<void> {
  const emoji = REACTION_EMOJI[reaction]
  try {
    await ctx.react(emoji)
  } catch (err) {
    console.warn(`[reactions] setMessageReaction failed (${emoji}):`, err)
    await ctx.reply(REACTION_FALLBACK_TEXT[reaction])
  }
}

/**
 * Clears all reactions from the current message.
 * Silently ignores errors.
 */
export async function clearReaction(ctx: Context): Promise<void> {
  try {
    await ctx.react([])
  } catch {
    // ignore
  }
}
