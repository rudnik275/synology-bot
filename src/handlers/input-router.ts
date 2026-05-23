import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../infra/synology/client.ts'
import type { TolokaClient } from '../infra/toloka/client.ts'
import { extractMagnet } from '../domain/magnet-extractor.ts'
import { setReaction } from '../infra/telegram/reactions.ts'
import { startFolderPicker, registerMagnetFlow, type FolderPickerState } from './flows/folder-picker.ts'
import { runTolokaSearch } from './routes/search.ts'

export type InputClass = 'magnet' | 'search' | 'unknown'

const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 200

/**
 * Classifies the input text into a known input type.
 * Pure function — no side effects.
 *
 * Priority order:
 *   1. Contains magnet URI → 'magnet'
 *   2. Starts with '/' (slash command) → 'unknown' (handled by command router)
 *   3. Empty / whitespace-only → 'unknown'
 *   4. Too short (< 3 chars) → 'unknown' (avoids accidental yes/no searches)
 *   5. Too long (> 200 chars) → 'unknown' (probably a paste, not a query)
 *   6. Otherwise → 'search'
 */
export function classifyInput(text: string): InputClass {
  if (extractMagnet(text)) return 'magnet'

  const trimmed = text.trim()

  if (trimmed.startsWith('/')) return 'unknown'
  if (trimmed.length === 0) return 'unknown'
  if (trimmed.length < MIN_QUERY_LENGTH) return 'unknown'
  if (trimmed.length > MAX_QUERY_LENGTH) return 'unknown'

  return 'search'
}

type PickerSession = { state: FolderPickerState; pickerId: number; originalMsgId: number }

/**
 * Registers the message:text handler that routes messages to the appropriate flow.
 */
export function registerInputRouter(
  bot: Bot<Context>,
  synology: SynologyClient,
  toloka: TolokaClient
): void {
  const sessions = new Map<number, PickerSession>()

  // Register the callback_query handler for folder picker interactions
  registerMagnetFlow(bot, synology, sessions)

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    const kind = classifyInput(text)

    if (kind === 'magnet') {
      const magnet = extractMagnet(text)!
      const originalMsgId = ctx.message.message_id

      // Set pending reaction on the original message
      await setReaction(ctx, 'pending')

      await startFolderPicker(ctx, magnet, originalMsgId, synology, sessions)
      return
    }

    if (kind === 'search') {
      const query = text.trim()
      await runTolokaSearch(ctx, query, { toloka })
      return
    }

    // 'unknown' — fall through, do nothing
  })
}
