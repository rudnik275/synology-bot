import type {BotContext} from '../types.ts'
import {Bot, InputFile} from 'grammy'
import {createConversation} from '@grammyjs/conversations'
import {downloadTorrent, searchToloka} from '../utils/toloka-api.ts'
import {chooseFolder} from '../utils/choose-folder.ts'
import {createDownloadTask} from '../utils/synology-api.ts'
import {getFileUrl} from '../utils/utils.ts'

export function registerSearchMenu(bot: Bot<BotContext>) {
  bot.use(
    createConversation<BotContext>(
      async function searchTolokaConversation(conversation, ctx) {
        try {
          await ctx.reply('Enter search query', {
            reply_markup: {
              remove_keyboard: true
            }
          })
          const {message} = await conversation.wait()
          if (!message?.text) {
            await ctx.reply('Error: expect text here')
            return
          }
          const query = message.text
          await ctx.reply('Loading...')
          const results = await conversation.external(() => searchToloka(query))

          if (results.length === 0) {
            await ctx.reply('Empty results')
            return
          }

          await ctx.reply(
            results.map(item => `(${item.size}) ${item.title}`).join('\n\n'),
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  ...results.map((item, index) => ([{
                    text: `(${item.size}) ${item.title}`,
                    callback_data: index.toString()
                  }])),
                  [{
                    text: '⬅️',
                    callback_data: '__back'
                  }]
                ]
              }
            }
          )

          const searchSelectAction = await conversation.waitFor('callback_query:data')
          const selectedAction = searchSelectAction.callbackQuery.data

          if (selectedAction === '__back') {
            await ctx.reply('Cancel')
            return
          }

          const selectedIndex = +selectedAction
          const resultItem = results[selectedIndex]!
          await ctx.reply(`You pick ${resultItem.title}`)
          await ctx.reply(`Loading...`)

          const folder = await chooseFolder(conversation, ctx)
          if (!folder) {
            return ctx.reply('Cancel')
          }
          await ctx.reply('Loading...')
          const file = await downloadTorrent(resultItem.url)

          const fileId = (await ctx.replyWithDocument(
            new InputFile(file as any, 'file.torrent')
          )).document!.file_id

          const filePath = (await ctx.api.getFile(fileId)).file_path!
          await createDownloadTask(folder, getFileUrl(filePath))
          await ctx.reply(`👌 \n\nStart download (${resultItem.size}) ${resultItem.title}\n\n/${folder}`)
        } catch (err) {
          await ctx.reply('Error')
        }
      }
    )
  )

  return (ctx: BotContext) => ctx.conversation.enter('searchTolokaConversation')
}
