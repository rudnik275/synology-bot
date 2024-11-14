import {Context, Markup, session, Telegraf} from 'telegraf'
import type {MiddlewareFn,} from 'telegraf'
import {message} from 'telegraf/filters'
import {getCommandName} from './utils'

interface TelegraphSession {
  fileId?: string
}

interface TelegraphContext extends Context {
  session: TelegraphSession
}

interface CommandShortcut {
  command: string
  description: string
}

export class Bot {
  bot = new Telegraf<TelegraphContext>(process.env.BOT_TOKEN)

  // data for button with shortcuts in telegram
  commandsShortcuts: CommandShortcut[] = []

  constructor() {
    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
    this.bot.use(session())
    this.bot.use((ctx, next) => {
      if (!ctx.session) {
        ctx.session = {}
      }
      return next()
    })
  }

  ownerMiddleware: MiddlewareFn<TelegraphContext> = (ctx, next) => {
    if (ctx.chat?.type === 'private' && ctx.chat.username === process.env.OWNER_USERNAME) {
      return next()
    } else {
      return ctx.reply('🚩 You dont have permission to use this command.')
    }
  }

  addCommand(
    command: string,
    description: string,
    action: (reply: (text: string) => Promise<any>) => Promise<void>,
  ) {
    this.commandsShortcuts.push({command, description})
    this.bot.command(command, this.ownerMiddleware, async (ctx) => action((text) => ctx.reply(text)))

    return this
  }

  async onUploadFile(
    fetchFolders: () => Promise<string[]>,
    createDownloadTask: (folder: string, fileUrl: string) => Promise<boolean>,
  ) {
    const folders = await fetchFolders()
    this.bot.on(message('document'), this.ownerMiddleware, async (ctx) => {
      console.log(ctx.message.document)
      if (ctx.message.document.mime_type !== 'application/x-bittorrent') {
        return ctx.reply('🚩 Wrong file format, please load *.torrent')
      }

      ctx.session.fileId = ctx.message.document.file_id

      const keyboardPanel = Markup.inlineKeyboard([
        folders.map(folder => Markup.button.callback(folder, getCommandName(folder)))
          .concat(Markup.button.callback('❌', 'cancel')),
      ])
      await ctx.reply('📁 Choose destination folder', keyboardPanel)
    })

    for (const folder of folders) {
      const chooseModeMiddleware: MiddlewareFn<TelegraphContext> = (ctx, next) => {
        if (ctx.session.fileId) return next()
      }
      // actions works only after upload document. Accept messages only when session.fileId is exists
      this.bot.action(getCommandName(folder), this.ownerMiddleware, chooseModeMiddleware, async (ctx) => {
        const fileLink = await ctx.telegram.getFileLink(ctx.session.fileId as string)
        const isSuccess = await createDownloadTask(folder, fileLink.href)
        ctx.session.fileId = undefined
        await ctx.editMessageReplyMarkup(undefined)
        await ctx.reply(isSuccess ? '👌' : '🚩')
      })
    }
    this.bot.action('cancel', (ctx) => {
      ctx.editMessageReplyMarkup(undefined)
      ctx.reply('👌')
      ctx.session.fileId = undefined
    })

    return this
  }

  async launch() {
    await this.bot.telegram.setMyCommands(this.commandsShortcuts)
    await this.bot.launch()
  }
}
