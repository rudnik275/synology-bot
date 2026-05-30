import type { Bot, Context } from 'grammy'
import type { PersistentStore } from '../../infra/persistence/store.ts'
import { openTorrentButton } from '../../infra/notify/miniapp-link.ts'

/** How long a forwarded .torrent stays fetchable by the Mini App. */
export const STASH_TTL_MS = 15 * 60 * 1000

export interface TorrentIntakeDeps {
  store: Pick<PersistentStore, 'stashTorrent'>
  botToken: string
  miniappUrl: string
  /** Download the file bytes from Telegram. Injectable for tests. */
  fetchFileBytes?: (filePath: string, botToken: string) => Promise<Uint8Array>
  /** Generate the stash token. Injectable for tests. */
  makeToken?: () => string
}

function isTorrentDocument(doc: { file_name?: string; mime_type?: string }): boolean {
  const name = (doc.file_name ?? '').toLowerCase()
  return name.endsWith('.torrent') || doc.mime_type === 'application/x-bittorrent'
}

async function defaultFetchFileBytes(filePath: string, botToken: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
  if (!res.ok) throw new Error(`file download failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

function defaultMakeToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * Handle a `.torrent` document forwarded to the bot (#99). Runs after the
 * owner-only guard, so the sender is already the owner. Stashes the file
 * server-side under a short-lived token and replies with a Mini App deep-link
 * that opens AddFlow on the stashed torrent.
 */
export function registerTorrentIntakeRoute(bot: Bot<Context>, deps: TorrentIntakeDeps): void {
  const fetchBytes = deps.fetchFileBytes ?? defaultFetchFileBytes
  const makeToken = deps.makeToken ?? defaultMakeToken

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document
    if (!doc || !isTorrentDocument(doc)) {
      await ctx.reply('Это не .torrent-файл. Пришлите файл с расширением .torrent.')
      return
    }

    if (!deps.miniappUrl) {
      await ctx.reply('Mini App не настроен — добавить .torrent через бота сейчас нельзя.')
      return
    }

    let bytes: Uint8Array
    try {
      const file = await ctx.getFile()
      if (!file.file_path) throw new Error('no file_path')
      bytes = await fetchBytes(file.file_path, deps.botToken)
    } catch {
      await ctx.reply('Не удалось скачать файл. Попробуйте отправить его ещё раз.')
      return
    }

    const token = makeToken()
    deps.store.stashTorrent(token, doc.file_name ?? 'download.torrent', bytes, STASH_TTL_MS)

    await ctx.reply('Файл получен. Откройте Mini App, чтобы выбрать папку и начать загрузку.', {
      reply_markup: openTorrentButton(deps.miniappUrl, token),
    })
  })
}
