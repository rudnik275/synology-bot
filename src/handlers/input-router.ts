import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../infra/synology/client.ts'
import { extractMagnet } from '../domain/magnet-extractor.ts'
import { setReaction } from '../infra/telegram/reactions.ts'
import { startFolderPicker, registerMagnetFlow, type FolderPickerState } from './flows/folder-picker.ts'

export type InputClass = 'magnet' | 'unknown'

/**
 * Classifies the input text into a known input type.
 * Pure function — no side effects.
 */
export function classifyInput(text: string): InputClass {
  if (extractMagnet(text)) return 'magnet'
  return 'unknown'
}

type PickerSession = { state: FolderPickerState; pickerId: number; originalMsgId: number }

/**
 * Registers the message:text handler that routes messages to the appropriate flow.
 */
export function registerInputRouter(bot: Bot<Context>, synology: SynologyClient): void {
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

    // Other input types will be handled by future slices (search, etc.)
    // Fall through: do nothing for unknown input
  })
}
