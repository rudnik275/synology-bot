import type { Bot, Context } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { setReaction } from '../../infra/telegram/reactions.ts'

export interface FolderEntry {
  name: string
  path: string
}

/**
 * In-memory state machine for the folder picker conversation.
 * Lives keyed by chatId in the MagnetFlow handler.
 */
export class FolderPickerState {
  readonly magnet: string
  readonly breadcrumb: FolderEntry[] = []

  constructor(magnet: string) {
    this.magnet = magnet
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
 * Handles the full folder-picker flow for a magnet link.
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
      await ctx.editMessageText('❌ Сессия устарела. Пришли magnet ещё раз.')
      return
    }

    const data = ctx.callbackQuery.data

    if (data === 'fp:cancel') {
      sessions.delete(chatId)
      await ctx.editMessageText('❌ Отменено.')
      // Try to clear the hourglass reaction on original message
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
      const result = await synology.createDownloadTask(session.state.magnet, destination)

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

      await ctx.editMessageText(`✅ Качается → ${destination}`)
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
 * Starts the folder picker for a given magnet URI.
 * Sends the initial message and registers the session.
 */
export async function startFolderPicker(
  ctx: Context,
  magnet: string,
  originalMsgId: number,
  synology: SynologyClient,
  sessions: Map<number, { state: FolderPickerState; pickerId: number; originalMsgId: number }>
): Promise<void> {
  const chatId = ctx.chat?.id
  if (!chatId) return

  const state = new FolderPickerState(magnet)

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
