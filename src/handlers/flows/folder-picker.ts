import type { Bot, Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { setReaction } from '../../infra/telegram/reactions.ts'

export interface FolderEntry {
  name: string
  path: string
}

/**
 * Discriminated union describing what the owner wants to download.
 * - magnet: a magnet URI string
 * - torrentFile: raw bytes of a .torrent file + its filename
 */
export type TorrentInput =
  | { kind: 'magnet'; value: string }
  | { kind: 'torrentFile'; bytes: Uint8Array; name: string }

/**
 * In-memory state machine for the folder picker conversation.
 * Lives keyed by chatId in the InputRouter handler.
 *
 * Accepts either:
 * - A TorrentInput union (magnet | torrentFile) — preferred
 * - A raw magnet string — legacy, kept for backward compatibility
 */
export class FolderPickerState {
  readonly input: TorrentInput
  readonly breadcrumb: FolderEntry[] = []

  constructor(input: TorrentInput | string) {
    if (typeof input === 'string') {
      this.input = { kind: 'magnet', value: input }
    } else {
      this.input = input
    }
  }

  /**
   * The magnet URI if this session was started from a magnet link, otherwise empty string.
   * Kept for backward compatibility.
   */
  get magnet(): string {
    return this.input.kind === 'magnet' ? this.input.value : ''
  }

  get currentPath(): string | null {
    return this.breadcrumb.length > 0 ? this.breadcrumb[this.breadcrumb.length - 1].path : null
  }

  get isAtRoot(): boolean {
    return this.breadcrumb.length === 0
  }

  drillDown(folder: FolderEntry): void {
    this.breadcrumb.push(folder)
  }

  goBack(): void {
    this.breadcrumb.pop()
  }
}

interface KeyboardButton {
  text: string
  callback_data: string
}

/**
 * Build an inline keyboard for the folder picker.
 * Each folder button has callback_data prefixed so the handler can dispatch.
 */
export function buildFolderKeyboard(folders: FolderEntry[], isAtRoot: boolean): KeyboardButton[][] {
  const rows: KeyboardButton[][] = []

  if (!isAtRoot) {
    rows.push([{ text: '📁 ..', callback_data: 'fp:back' }])
  }

  for (const folder of folders) {
    rows.push([
      {
        text: `📁 ${folder.name}`,
        callback_data: `fp:enter:${encodeURIComponent(folder.path)}:${encodeURIComponent(folder.name)}`,
      },
    ])
  }

  rows.push([
    { text: '✅ Выбрать эту папку', callback_data: 'fp:select' },
    { text: '❌ Отмена', callback_data: 'fp:cancel' },
  ])

  return rows
}

function toInlineKeyboard(rows: KeyboardButton[][]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const row of rows) {
    for (const btn of row) {
      kb.text(btn.text, btn.callback_data)
    }
    kb.row()
  }
  return kb
}

function formatPath(state: FolderPickerState): string {
  if (state.isAtRoot) return '/'
  return state.currentPath ?? '/'
}

/**
 * Handles the full folder-picker flow for any TorrentInput (magnet or .torrent file).
 * - Sends one picker message with the share list.
 * - On callback_query, edits that same message in-place.
 */
export function registerMagnetFlow(
  bot: Bot<Context>,
  synology: SynologyClient,
  sessions: Map<number, { state: FolderPickerState; pickerId: number; originalMsgId: number }>
): void {
  // callback_query handler for all fp: prefixed callbacks
  bot.callbackQuery(/^fp:/, async (ctx) => {
    await ctx.answerCallbackQuery()

    const chatId = ctx.chat?.id
    if (!chatId) return

    const session = sessions.get(chatId)
    if (!session) {
      await ctx.editMessageText('❌ Сессия устарела. Пришли файл или magnet ещё раз.')
      return
    }

    const data = ctx.callbackQuery.data

    if (data === 'fp:cancel') {
      sessions.delete(chatId)
      await ctx.editMessageText('❌ Отменено.')
      // Try to clear the reaction on original message
      try {
        await ctx.api.setMessageReaction(chatId, session.originalMsgId, [])
      } catch {
        // ignore
      }
      return
    }

    if (data === 'fp:back') {
      session.state.goBack()
      await renderPicker(ctx, chatId, session.state, synology)
      return
    }

    if (data === 'fp:select') {
      const destination = session.state.currentPath ?? '/'
      let result: { ok: true } | { ok: false; reason: string }

      if (session.state.input.kind === 'magnet') {
        result = await synology.createDownloadTask(session.state.input.value, destination)
      } else {
        result = await synology.createDownloadTaskFromFile(
          session.state.input.bytes,
          session.state.input.name,
          destination
        )
      }

      if (!result.ok) {
        await ctx.editMessageText(`❌ Ошибка: ${result.reason}`)
        try {
          await ctx.api.setMessageReaction(chatId, session.originalMsgId, [{ type: 'emoji', emoji: '👎' }])
        } catch {
          await ctx.api.sendMessage(chatId, '❌ Ошибка создания задачи.')
        }
        sessions.delete(chatId)
        return
      }

      const label =
        session.state.input.kind === 'magnet'
          ? session.state.input.value.slice(0, 60)
          : session.state.input.name

      await ctx.editMessageText(`✅ Качается → ${destination}\n${label}`)
      try {
        await ctx.api.setMessageReaction(chatId, session.originalMsgId, [{ type: 'emoji', emoji: '👍' }])
      } catch {
        await ctx.api.sendMessage(chatId, '✅ Задача создана.')
      }
      sessions.delete(chatId)
      return
    }

    // fp:enter:<encoded-path>:<encoded-name>
    if (data.startsWith('fp:enter:')) {
      const parts = data.split(':')
      // parts: ['fp', 'enter', encodedPath, encodedName]
      const path = decodeURIComponent(parts[2])
      const name = decodeURIComponent(parts[3])
      session.state.drillDown({ name, path })
      await renderPicker(ctx, chatId, session.state, synology)
      return
    }
  })
}

async function renderPicker(
  ctx: Context,
  chatId: number,
  state: FolderPickerState,
  synology: SynologyClient
): Promise<void> {
  let folders: FolderEntry[]

  if (state.isAtRoot) {
    const result = await synology.listSharedFolders()
    if (!result.ok) {
      await ctx.editMessageText(`❌ Не удалось получить список папок: ${result.reason}`)
      return
    }
    folders = result.data
  } else {
    const result = await synology.listFolders(state.currentPath!)
    if (!result.ok) {
      await ctx.editMessageText(`❌ Не удалось открыть папку: ${result.reason}`)
      return
    }
    folders = result.data
  }

  const rows = buildFolderKeyboard(folders, state.isAtRoot)
  const kb = toInlineKeyboard(rows)
  const pathLabel = formatPath(state)

  await ctx.editMessageText(`📂 Выбери папку назначения\n\nТекущий путь: ${pathLabel}`, {
    reply_markup: kb,
  })
}

/**
 * Starts the folder picker for a given TorrentInput (magnet or .torrent file).
 * Sends the initial message and registers the session.
 */
export async function startFolderPicker(
  ctx: Context,
  input: TorrentInput,
  originalMsgId: number,
  synology: SynologyClient,
  sessions: Map<number, { state: FolderPickerState; pickerId: number; originalMsgId: number }>
): Promise<void> {
  const chatId = ctx.chat?.id
  if (!chatId) return

  const state = new FolderPickerState(input)

  // Fetch top-level shares immediately
  const result = await synology.listSharedFolders()
  if (!result.ok) {
    await ctx.reply(`❌ Не удалось получить список папок: ${result.reason}`)
    return
  }

  const rows = buildFolderKeyboard(result.data, true)
  const kb = toInlineKeyboard(rows)

  const sent = await ctx.reply('📂 Выбери папку назначения\n\nТекущий путь: /', {
    reply_markup: kb,
  })

  sessions.set(chatId, { state, pickerId: sent.message_id, originalMsgId })
}
