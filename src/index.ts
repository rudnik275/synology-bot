import {Bot, Keyboard, session,} from 'grammy'
import {conversations} from '@grammyjs/conversations'
import type {BotContext} from './types.ts'
import {registerDownloadsMenu} from './modules/downloads.ts'
import {registerSearchMenu} from './modules/search-toloka.ts'
import {handleTorrentFile} from './modules/handle-torrent-file.ts'

const bot = new Bot<BotContext>(process.env.BOT_TOKEN)
bot.use(session({initial: () => ({})}))
bot.use(conversations())

bot.use((ctx, next) => {
  if (ctx.chat?.type === 'private' && process.env.OWNER_USERNAME === ctx.chat.username) {
    return next()
  } else {
    return ctx.reply('🚩 You dont have permission to use this command.')
  }
})

const keyboard = new Keyboard()
  .resized()
  .persistent()
  .text('Downloads')
  .text('Search')

bot.command('menu', async (ctx) => {
  await ctx.conversation.exit()
  await ctx.reply('Menu:', {
    reply_markup: keyboard
  })
})

bot.api.setMyCommands([{
  command: 'menu',
  description: 'Menu'
}])

const runDownloadsMenu = registerDownloadsMenu(bot)
const runSearchMenu = registerSearchMenu(bot)

handleTorrentFile(bot)

bot.on('message:text', async (ctx) => {
  switch (ctx.message.text) {
    case 'Downloads':
      await runDownloadsMenu(ctx)
      break
    case 'Search':
      await runSearchMenu(ctx)
      break
  }
})

await bot.start()
console.log('bot stopped')
