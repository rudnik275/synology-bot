import {Bot, type CommandMiddleware, Context, InputFile, session} from 'grammy'
import {type ConversationFlavor, conversations, createConversation, type Conversation} from '@grammyjs/conversations'
import {cleanTasks, createDownloadTask, getFoldersList, getTasks} from './synology.ts'
import {formatSynologyTask} from './utils.ts'
import type {BotCommand} from 'grammy/types'
import {downloadTorrent, searchToloka} from './toloka.ts'

/**
 * process.env variables:
 *  - BOT_TOKEN
 *  - OWNER_USERNAME
 *  - SYNOLOGY_HOST
 *  - SYNOLOGY_USER
 *  - SYNOLOGY_PASSWORD
 */

type BotContext = Context & ConversationFlavor

const bot = new Bot<BotContext>(process.env.BOT_TOKEN)
process.once('SIGINT', bot.stop)
process.once('SIGTERM', bot.stop)
bot.use(session({initial: () => ({})}))
bot.use(conversations())

// is valid user
bot.use((ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.chat.username === process.env.OWNER_USERNAME) {
    return next()
  } else {
    return ctx.reply('🚩 You dont have permission to use this command.')
  }
})

const getFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`
const chooseFolder = async (conversation: Conversation<BotContext>, ctx: BotContext): Promise<string> => {
  const folders = await getFoldersList()
  await ctx.reply('📁 Choose destination folder', {
    reply_markup: {
      inline_keyboard: [
        folders.map(f => ({
          text: f,
          callback_data: f
        }))
      ]
    }
  })
  const action = await conversation.waitFor('callback_query:data')

  return action.callbackQuery.data as string
}

const commandsMenu: BotCommand[] = []
const addCommand = (id: string, label: string, middleware: CommandMiddleware<BotContext>) => {
  bot.command(id, middleware)
  commandsMenu.push({
    command: id,
    description: label
  })
}

addCommand('status', 'Status', async (ctx) => {
  const tasks = await getTasks()
  if (tasks.length === 0)
    return ctx.reply('Downloads is empty')

  for (const task of tasks) {
    await ctx.reply(
      formatSynologyTask(task),
    )
  }
})

addCommand('clean', 'Clean completed', async ({reply}) => {
  await cleanTasks()
  await reply('🧹')
})

bot.use(
  createConversation<BotContext>(
    async function tolokaSearch(conversation, ctx) {
      await ctx.reply('Search query?')
      const {message} = await conversation.wait()
      if (!message?.text) return
      const query = message.text
      const results = await conversation.external(() => searchToloka(query))

      await ctx.reply(
        results
          .map((i, index) => `*\[${index}\]* - ${i.title}`)
          .join('\n\n'),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              results.map((i, index) => ({
                text: index.toString(),
                callback_data: i.url
              }))
            ]
          }
        }
      )

      const action = await conversation.waitFor('callback_query:data')
      const downloadLink = action.callbackQuery.data

      const folder = await chooseFolder(conversation, ctx)
      const file = await downloadTorrent(downloadLink)

      const fileId = (await ctx.replyWithDocument(
        new InputFile(file as any, 'file.torrent')
      )).document!.file_id
      const filePath = (await ctx.api.getFile(fileId)).file_path!
      await createDownloadTask(folder, getFileUrl(filePath))
      await ctx.reply('👌')
    },
  )
)

addCommand('toloka', 'Search toloka', ({conversation}) => conversation.enter('tolokaSearch'))

bot.use(
  createConversation<BotContext>(
    async function uploadFile(conversation, ctx) {
      const folder = await chooseFolder(conversation, ctx)
      const fileId = ctx.message!.document!.file_id
      const filePath = (await ctx.api.getFile(fileId)).file_path!
      await createDownloadTask(folder, getFileUrl(filePath))
      await ctx.reply('👌')
    }
  )
)

bot.on('message:document', async (ctx) => {
  if (ctx.message.document.mime_type !== 'application/x-bittorrent') {
    return ctx.reply('🚩 Wrong file format, please load *.torrent')
  }

  await ctx.conversation.enter('uploadFile')
})

await bot.api.setMyCommands(commandsMenu)
await bot.start()

console.log('bot stopped')
