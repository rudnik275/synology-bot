import {Markup, session, Telegraf} from 'telegraf'
import {message} from 'telegraf/filters'
import {getCommandName} from './utils.js'

export const createBot = () => {
  const bot = new Telegraf(process.env.BOT_TOKEN)

  // gentle stop bot on CTRL+C
  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))

  bot.use(session())
  bot.use((ctx, next) => {
    if (!ctx.session) {
      ctx.session = {}
    }
    return next()
  })

  // accept messages only from current user
  const ownerMiddleware = (ctx, next) => {
    if (ctx.chat.username === process.env.OWNER_USERNAME) {
      return next()
    } else {
      return ctx.reply('🚩 You dont have permission to use this command.')
    }
  }

  // data for button with shortcuts in telegram
  const commandsShortcuts = []

  const appContext = {
    addCommand(command, description, action) {
      commandsShortcuts.push({command, description})
      bot.command(command, ownerMiddleware, async (ctx) => action((text) => ctx.reply(text)))
      return appContext
    },
    onUploadFile:async (fetchFolders, createDownloadTask) => {
      const folders = await fetchFolders()
      bot.on(message('document'), ownerMiddleware, async (ctx) => {
        if (ctx.message.document.mime_type !== 'application/x-bittorrent') {
          return ctx.reply('🚩 Wrong file format, please load *.torrent')
        }

        ctx.session.fileId = ctx.message.document.file_id

        const keyboardPanel = Markup.inlineKeyboard([
          folders.map(folder => Markup.button.callback(folder, getCommandName(folder)))
            .concat(Markup.button.callback('Cancel', 'cancel'))
        ])
        ctx.reply('📁 Choose folder', keyboardPanel)
      })

      for (const folder of folders) {
        const chooseModeMiddleware = (ctx, next) => {
          if (ctx.session.fileId) return next()
        }
        // actions works only after upload document. Accept messages only when session.fileId is exists
        bot.action(getCommandName(folder), ownerMiddleware, chooseModeMiddleware, async (ctx) => {
          const fileLink = await ctx.telegram.getFileLink(ctx.session.fileId)
          const isSuccess = await createDownloadTask(folder, fileLink.href)
          ctx.editMessageReplyMarkup()
          ctx.reply(isSuccess ? '👌' : '🚩')
          ctx.session.fileId = undefined
        })
      }
      bot.action('cancel', (ctx) => {
        ctx.editMessageReplyMarkup()
        ctx.reply('👌')
        ctx.session.fileId = undefined
      })

      return appContext
    },
    launch: async () => {
      await bot.telegram.setMyCommands(commandsShortcuts)
      await bot.launch()
    }
  }

  return appContext
}
