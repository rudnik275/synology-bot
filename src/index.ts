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
 *  - TOLOKA_USERNAME
 *  - TOLOKA_PASSWORD
 *  - PUBLIC_USERNAMES
 */

type BotContext = Context & ConversationFlavor

const bot = new Bot<BotContext>(process.env.BOT_TOKEN)
process.once('SIGINT', bot.stop)
process.once('SIGTERM', bot.stop)
bot.use(session({initial: () => ({})}))
bot.use(conversations())

const commandsMenu: BotCommand[] = []
const addCommand = (id: string, label: string, middleware: CommandMiddleware<BotContext>) => {
  bot.command(id, middleware)
  commandsMenu.push({
    command: id,
    description: label,
  })
}

bot.use((ctx, next) => {
  const publicUsers = (process.env.PUBLIC_USERNAMES || '').split(',')
  if (ctx.chat?.type === 'private' && [process.env.OWNER_USERNAME, ...publicUsers].includes(ctx.chat.username!)) {
    return next()
  } else {
    return ctx.reply('🚩 You dont have permission to use this command.')
  }
})

async function searchTolokaConversation(conversation: Conversation<BotContext>, ctx: BotContext) {
  await ctx.reply('Search query?')
  const {message} = await conversation.wait()
  if (!message?.text) {
    await ctx.reply('Error: expect text here')
    return
  }
  const query = message.text
  const results = await conversation.external(() => searchToloka(query))
  if (results.length === 0) {
    await ctx.reply('Empty results')
    return
  }

  await ctx.reply(
    results
      .map((i, index) => `*\[${index}\]* - ${i.title}`)
      .join('\n\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          results.map((_, index) => ({
            text: index.toString(),
            callback_data: index.toString()
          })),
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
  await ctx.reply(`You choose, [${selectedIndex}], ${resultItem.title}`)

  const file = await downloadTorrent(resultItem.url)

  const fileId = (await ctx.replyWithDocument(
    new InputFile(file as any, 'file.torrent')
  )).document!.file_id

  return [resultItem.title, fileId] as const
}

async function searchTolokaAndDownloadNas(conversation: Conversation<BotContext>, ctx: BotContext) {
  const searchResult = await searchTolokaConversation(conversation, ctx)
  if (!searchResult) return

  const [resultItemTitle, fileId] = searchResult
  const folder = await chooseFolder(conversation, ctx)
  if (!folder) {
    return ctx.reply('Cancel')
  }
  const filePath = (await ctx.api.getFile(fileId)).file_path!
  await createDownloadTask(folder, getFileUrl(filePath))
  await ctx.reply(`👌, Start download ${resultItemTitle} into "${folder}"`)
}

bot.use(
  createConversation<BotContext>(
    searchTolokaConversation
  )
)

bot.use(
  createConversation<BotContext>(
    searchTolokaAndDownloadNas
  )
)

addCommand('search_toloka', 'Search toloka', ({conversation}) => conversation.enter('searchTolokaConversation'))

// next commands should be private
bot.use((ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.chat.username === process.env.OWNER_USERNAME) {
    return next()
  } else {
    return ctx.reply('🚩 You dont have permission to use this command.')
  }
})

const getFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`
const chooseFolder = async (conversation: Conversation<BotContext>, ctx: BotContext): Promise<string | undefined> => {
  const folders = await getFoldersList()
  await ctx.reply('📁 Choose destination folder', {
    reply_markup: {
      inline_keyboard: [
        folders.map(f => ({
          text: f,
          callback_data: f
        })),
        [
          {
            text: '⬅️',
            callback_data: '__back'
          }
        ]
      ]
    }
  })

  const action = await conversation.waitFor('callback_query:data')
  const cbData = action.callbackQuery.data

  if (cbData === '__back') return

  return cbData
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

addCommand('clean', 'Clean completed', async (ctx) => {
  await cleanTasks()
  await ctx.reply('🧹')
})

addCommand('search_toloka_nas', 'Search toloka NAS', ({conversation}) => conversation.enter('searchTolokaAndDownloadNas'))

bot.use(
  createConversation<BotContext>(
    async function uploadFile(conversation, ctx) {
      const folder = await chooseFolder(conversation, ctx)
      if (!folder) {
        return ctx.reply('Cancel')
      }
      const fileId = ctx.message!.document!.file_id
      const filePath = (await ctx.api.getFile(fileId)).file_path!
      await createDownloadTask(folder, getFileUrl(filePath))
      await ctx.reply(`👌, Start download into "${folder}"`)
    }
  )
)

bot.on('message:document', async (ctx) => {
  if (!ctx.message.document.file_name!.endsWith('.torrent')) {
    return ctx.reply('🚩 Wrong file format, please load *.torrent')
  }

  await ctx.conversation.enter('uploadFile')
})

await bot.api.setMyCommands(commandsMenu)
await bot.start()

console.log('bot stopped')
