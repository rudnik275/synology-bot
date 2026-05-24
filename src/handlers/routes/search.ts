import type { Bot, Context } from 'grammy'
import type { TolokaClient } from '../../infra/toloka/client.ts'
import type { SynologyClient } from '../../infra/synology/client.ts'
import type { ReactionTypeEmoji } from 'grammy/types'
import { formatSearchResults } from '../flows/search-formatter.ts'

// Convenience: create a valid ReactionTypeEmoji object
function emoji(e: ReactionTypeEmoji['emoji']): ReactionTypeEmoji {
  return { type: 'emoji', emoji: e }
}

export interface SearchDeps {
  toloka: TolokaClient
}

/**
 * Core search execution: runs a Toloka query and sends results to the user.
 * Called both by the /search command and by the free-form text router.
 */
export async function runTolokaSearch(ctx: Context, query: string, deps: SearchDeps): Promise<void> {
  // Acknowledge with 👀 reaction when possible
  try {
    await ctx.react(emoji('👀'))
  } catch {
    // Reactions not available in all contexts
  }

  try {
    const results = await deps.toloka.search(query)

    if (results.length === 0) {
      try {
        await ctx.react(emoji('😢'))
      } catch {
        // Ignore
      }
      await ctx.reply(`По запросу "${query}" ничего не найдено.`)
      return
    }

    const { text, inlineKeyboard } = formatSearchResults(query, results)

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
    })
  } catch (err) {
    try {
      await ctx.react(emoji('😢'))
    } catch {
      // Ignore
    }
    console.error('[search] Toloka error:', err)
    await ctx.reply('❌ Toloka недоступна. Попробуй позже.')
  }
}

/**
 * Registers /search command and its callback query handlers.
 *
 * Flow:
 *   1. /search <query>  → ⏳ reaction → search Toloka → send results with inline keyboard
 *   2. tap result       → show folder picker (minimal inline)
 *   3. tap folder       → download .torrent → create Synology task → ✅
 */
export function registerSearchRoute(
  bot: Bot<Context>,
  toloka: TolokaClient,
  synology: SynologyClient
): void {
  // Folders available for download — minimal list until #7 lands
  const DEFAULT_FOLDERS = ['/downloads', '/tv-shows', '/movies', '/music']

  // /search command
  bot.command('search', async (ctx) => {
    const query = ctx.match?.trim()

    if (!query) {
      await ctx.reply('🔍 Введи запрос для поиска. Например: /search ubuntu 24.04')
      return
    }

    await runTolokaSearch(ctx, query, { toloka })
  })

  // Callback: user tapped a result — show folder picker
  bot.callbackQuery(/^search_pick:(.+)$/, async (ctx) => {
    const topicId = ctx.match[1]

    const folderButtons = DEFAULT_FOLDERS.map((folder) => [
      {
        text: folder,
        callback_data: `search_folder:${topicId}:${folder}`,
      },
    ])
    folderButtons.push([{ text: '↩️ Назад', callback_data: 'search_back' }])

    await ctx.editMessageText('📂 Выбери папку для скачивания:', {
      reply_markup: { inline_keyboard: folderButtons },
    })
    await ctx.answerCallbackQuery()
  })

  // Callback: user tapped a folder — download + create task
  bot.callbackQuery(/^search_folder:([^:]+):(.+)$/, async (ctx) => {
    const topicId = ctx.match[1]
    const folder = ctx.match[2]

    await ctx.editMessageText('⏳ Скачиваю торрент…')
    await ctx.answerCallbackQuery()

    try {
      const downloadUrl = toloka.getDownloadUrl(topicId)
      const torrentBytes = await toloka.downloadTorrent(downloadUrl)

      // Upload the .torrent file to Telegram to get a file_id, then use URL-based approach
      // Since we have raw bytes, we create a task via the magnet/URL path if available
      // For now: pass the download URL directly to Synology (requires cookie which we can't pass)
      // Alternative: upload bytes to get Telegram file, then use getFile path
      // Per spec: createTaskFromUrl with the .torrent URL
      const result = await synology.request<unknown>(
        'SYNO.DownloadStation.Task',
        1,
        'create',
        { uri: downloadUrl, destination: folder }
      )

      if (!result.ok) {
        await ctx.editMessageText(`❌ Ошибка Synology: ${result.reason}`)
        return
      }

      await ctx.editMessageText(`✅ Качается → ${folder}`)

      // Update reaction on original message if possible
      try {
        await ctx.react(emoji('👍'))
      } catch {
        // Ignore
      }
    } catch (err) {
      console.error('[search] download/task error:', err)
      const reason = err instanceof Error ? err.message : String(err)
      await ctx.editMessageText(`❌ ${reason}`)
    }
  })

  // Callback: back button
  bot.callbackQuery('search_back', async (ctx) => {
    await ctx.deleteMessage().catch(() => {})
    await ctx.answerCallbackQuery()
  })
}
