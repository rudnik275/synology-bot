import type { Bot, Context } from 'grammy'
import type { PersistentStore } from '../../infra/persistence/store.ts'
import { openStashButton } from '../../infra/notify/miniapp-link.ts'
import { extractMagnet } from '../../domain/magnet-extractor.ts'

/** How long a forwarded add-intake (`.torrent` bytes / magnet / URL) stays fetchable by the Mini App. */
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

export interface UriIntakeDeps {
  store: Pick<PersistentStore, 'stashUri'>
  miniappUrl: string
  /** Generate the stash token. Injectable for tests. */
  makeToken?: () => string
}

/**
 * Is this chat text an add-intent link (#120)? Matches a `magnet:` link or an
 * `http(s)://` URL — mirrors the old in-wizard "Magnet / URL" mode, which
 * accepted any URI (so direct-`.torrent`-URL adds survive). Ordinary text is
 * ignored. The owner-only DM has no conversational traffic, so accepting any
 * http(s) link is safe (ADR 0008); tighten to `.torrent`-suffixed URLs if it bites.
 */
export function isAddIntakeUri(text: string): boolean {
  const t = text.trim()
  if (t.includes(' ') || t.includes('\n')) return false
  if (/^magnet:\?/i.test(t)) return true
  return /^https?:\/\/\S+$/i.test(t)
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
      reply_markup: openStashButton(deps.miniappUrl, token),
    })
  })
}

/**
 * Handle a magnet / `http(s)` URL pasted into the bot chat (#120). Runs after
 * the owner-only guard. The handler fires when the message text *is* such a
 * link (see {@link isAddIntakeUri}) or *contains* a magnet link anywhere in the
 * text (#299 — e.g. «Смотри: magnet:?xt=…» or a forwarded post); ordinary text
 * without a magnet is ignored. It stashes the URI server-side under a
 * short-lived token and replies with a Mini App deep-link that opens AddFlow
 * at the folder step. Magnet links can exceed the 512-char `start_param`
 * limit, so the URI is stashed, not carried inline.
 */
export function registerUriIntakeRoute(bot: Bot<Context>, deps: UriIntakeDeps): void {
  const makeToken = deps.makeToken ?? defaultMakeToken

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    // The whole message is a link, or a magnet is embedded in the text (#299).
    // Ordinary text without a magnet is not add-intent — stay silent so the DM isn't noisy.
    const uri = isAddIntakeUri(text) ? text.trim() : extractMagnet(text)
    if (!uri) return

    if (!deps.miniappUrl) {
      await ctx.reply('Mini App не настроен — добавить ссылку через бота сейчас нельзя.')
      return
    }

    const token = makeToken()
    deps.store.stashUri(token, uri, STASH_TTL_MS)

    await ctx.reply('Ссылка получена. Откройте Mini App, чтобы выбрать папку и начать загрузку.', {
      reply_markup: openStashButton(deps.miniappUrl, token),
    })
  })
}
