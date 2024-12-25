import type {BotContext} from '../types.ts'
import {chooseFolder} from '../utils/choose-folder.ts'
import {createDownloadTask} from '../utils/synology.ts'
import {createConversation} from '@grammyjs/conversations'
import {Bot,} from 'grammy'
import {getFileUrl} from '../utils/utils.ts'

export function handleTorrentFile(bot: Bot<BotContext>) {
  bot.use(
    createConversation<BotContext>(
      async function uploadFile(conversation, ctx) {
        await ctx.reply('Loading...')
        const folder = await chooseFolder(conversation, ctx)
        if (!folder) {
          return ctx.reply('Cancel')
        }
        const fileId = ctx.message!.document!.file_id
        const filePath = (await ctx.api.getFile(fileId)).file_path!
        await createDownloadTask(folder, getFileUrl(filePath))
        await ctx.reply(`👌, Start download into /${folder}`)
      }
    )
  )

  bot.on('message:document', async (ctx) => {
    if (!ctx.message.document.file_name!.endsWith('.torrent')) {
      return ctx.reply('🚩 Wrong file format, please load *.torrent')
    }

    await ctx.conversation.enter('uploadFile')
  })
}
