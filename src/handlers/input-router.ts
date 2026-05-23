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

/**
 * Returns true if the document looks like a .torrent file,
 * by MIME type or by file extension.
 */
export function isTorrentDocument(doc: { mime_type?: string; file_name?: string }): boolean {
  if (doc.mime_type === 'application/x-bittorrent') return true
  if (doc.file_name?.toLowerCase().endsWith('.torrent')) return true
  return false
}

type PickerSession = { state: FolderPickerState; pickerId: number; originalMsgId: number }

/**
 * Registers message handlers that route inputs to the appropriate flow:
 * - message:text containing a magnet URI → MagnetFlow (folder picker)
 * - message:document with a .torrent file → TorrentFileFlow (same folder picker)
 */
export function registerInputRouter(
  bot: Bot<Context>,
  synology: SynologyClient,
  toloka: TolokaClient
): void {
  const sessions = new Map<number, PickerSession>()

  // Register the callback_query handler for folder picker interactions
  registerMagnetFlow(bot, synology, sessions)

  // Handle magnet links in text messages
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    const kind = classifyInput(text)

    if (kind === 'magnet') {
      const magnet = extractMagnet(text)!
      const originalMsgId = ctx.message.message_id

      // Set pending reaction on the original message
      await setReaction(ctx, 'pending')

      await startFolderPicker(ctx, { kind: 'magnet', value: magnet }, originalMsgId, synology, sessions)
      return
    }

    if (kind === 'search') {
      const query = text.trim()
      await runTolokaSearch(ctx, query, { toloka })
      return
    }

    // 'unknown' — fall through, do nothing
  })

  // Handle .torrent file uploads / forwards
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document
    if (!isTorrentDocument(doc)) return

    const fileName = doc.file_name ?? 'download.torrent'
    const originalMsgId = ctx.message.message_id

    // Set pending reaction on the original message
    await setReaction(ctx, 'pending')

    // Download file bytes via grammy + fetch
    let bytes: Uint8Array
    try {
      const file = await ctx.api.getFile(doc.file_id)
      if (!file.file_path) {
        await ctx.reply('❌ Не удалось получить ссылку на файл')
        return
      }

      // Construct the Telegram CDN download URL from the file_path
      const botToken = (ctx.api as unknown as { token: string }).token
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`

      const response = await fetch(fileUrl)
      if (!response.ok) {
        await ctx.reply(`❌ Не удалось скачать файл: HTTP ${response.status}`)
        return
      }

      const buffer = await response.arrayBuffer()
      bytes = new Uint8Array(buffer)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await ctx.reply(`❌ Ошибка при загрузке файла: ${reason}`)
      return
    }

    await startFolderPicker(
      ctx,
      { kind: 'torrentFile', bytes, name: fileName },
      originalMsgId,
      synology,
      sessions
    )
  })
}
