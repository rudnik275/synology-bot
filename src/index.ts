import {Bot, Keyboard, session,} from 'grammy'
import {conversations} from '@grammyjs/conversations'
import type {BotContext, TvShow} from './types.ts'
import {registerDownloadsMenu} from './modules/downloads.ts'
import {registerSearchMenu} from './modules/search-toloka.ts'
import {handleTorrentFile} from './modules/handle-torrent-file.ts'
import {registerShowsSubscription} from './modules/shows-subscription.ts'
import {registerSubscriptionsPolling} from './modules/subscriptions-polling.ts'

const bot = new Bot<BotContext>(process.env.BOT_TOKEN)
bot.use(
  session({
    initial: () => ({
      subscription: {}
    })
  })
)
bot.use(conversations())

bot.use((ctx, next) => {
  if (ctx.chat?.type === 'private' && process.env.OWNER_USERNAME === ctx.chat.username) {
    return next()
  } else {
    return ctx.reply('🚩 You dont have permission to use this command.')
  }
})

enum MenuItem {
  Downloads = 'Downloads',
  Search = 'Search',
  Subscriptions = 'Subscriptions'
}

const keyboard = new Keyboard()
  .resized()
  .persistent()
  .text(MenuItem.Search)
  .text(MenuItem.Downloads)
  .text(MenuItem.Subscriptions)

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
const runShowsSubscription = registerShowsSubscription(bot)
registerSubscriptionsPolling(bot)
handleTorrentFile(bot)

bot.on('message:text', async (ctx) => {
  switch (ctx.message.text) {
    case MenuItem.Downloads:
      await runDownloadsMenu(ctx)
      break
    case MenuItem.Search:
      await runSearchMenu(ctx)
      break
    case MenuItem.Subscriptions:
      await runShowsSubscription(ctx)
      break
  }
})

await bot.start()
console.log('bot stopped')
