import {Bot} from 'grammy'
import type {BotContext, Show} from '../types.ts'
import axios, {type AxiosInstance} from 'axios'
import {Menu} from '@grammyjs/menu'
import {mkdir} from 'node:fs/promises'

const API_URL = 'https://api.myshows.me/v2/rpc/'

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
})

api.interceptors.request.use((request) => {
  Object.assign(request.data, {
    jsonrpc: '2.0',
    id: 1
  })
  return request
})
api.interceptors.response.use((response) => response.data)

export const search = (query: string) => api.post<{}, { result: Show[] }>('/', {
  method: 'shows.Search',
  params: {
    query,
  },
}).then(r => r.result.slice(0, 10))

const DB_FILE = 'db/data.json'
await mkdir('db', {recursive: true})
try {
  await Bun.file(DB_FILE).text()
} catch {
  await Bun.write(DB_FILE, `{}`)
}

const getSubscriptions = async () => {
  const raw = await Bun.file(DB_FILE).text()
  return JSON.parse(raw) as Record<number, Show>
}

const updateSubscriptions = async (updatedData: Record<number, Show>) => {
  await Bun.write(DB_FILE, JSON.stringify(updatedData))
}

export const registerShowsSubscription = (bot: Bot<BotContext>) => {
  // This bot includes two similar menus. On select item in search and current subscriptions
  // It shows Add or remove Button
  const assignSelectedMenuItems = (menu: Menu<BotContext>) => {
    menu
      .dynamic(async (ctx, range) => {
        const item = ctx.session.subscription.selectedItem!
        const subscriptions = await getSubscriptions()
        if (item.id in subscriptions) {
          range.text('Remove', async (ctx) => {
            delete subscriptions[item.id]
            await updateSubscriptions(subscriptions)
            ctx.menu.close()
            await ctx.reply('Removed')
            await showSubscriptions(ctx)
          })
        } else {
          range.text('Add', async (ctx) => {
            subscriptions[item.id] = item
            await updateSubscriptions(subscriptions)
            ctx.menu.close()
            await ctx.reply('Added')
            await showSubscriptions(ctx)
          })
        }
      })
      .row()
  }

  const subscriptionMenu = new Menu<BotContext>('subscriptionMenu')
    .text('Add new', async (ctx) => {
      ctx.session.subscription.isAwaitsSearchQuery = true
      await ctx.reply(`Enter search query`)
      ctx.menu.close()
    })
    .submenu('Edit', 'allSubscriptionsMenu')

  const selectedActiveSubscriptionMenu = new Menu<BotContext>('selectedActiveSubscriptionMenu')
  assignSelectedMenuItems(selectedActiveSubscriptionMenu)
  selectedActiveSubscriptionMenu
    .back('⬅️ Back', async (ctx) => {
      ctx.editMessageText(
        await getFormattedSubscriptions()
      )
    })

  const allSubscriptionsMenu = new Menu<BotContext>('allSubscriptionsMenu')
  allSubscriptionsMenu
    .dynamic(async (ctx, range) => {
      for (const subscription of Object.values(await getSubscriptions())) {
        range
          .submenu(subscription.title, 'selectedActiveSubscriptionMenu', (ctx) => {
            ctx.session.subscription.selectedItem = subscription
            ctx.editMessageText(subscription.title)
          })
          .row()
      }
    })
    .back('⬅️ Back')

  subscriptionMenu.register(allSubscriptionsMenu)
  allSubscriptionsMenu.register(selectedActiveSubscriptionMenu)
  bot.use(subscriptionMenu)

  const subscriptionSearchMenu = new Menu<BotContext>('subscriptionSearchMenu')
    .dynamic((ctx, range) => {
      for (const item of ctx.session.subscription.searchResults) {
        range
          .submenu(item.title, 'subscriptionSearchSelectedItemMenu', async (ctx) => {
            ctx.session.subscription.selectedItem = item
            ctx.editMessageText(item.title)
          })
          .row()
      }
    })

  const subscriptionSearchSelectedItemMenu = new Menu<BotContext>('subscriptionSearchSelectedItemMenu')
  assignSelectedMenuItems(subscriptionSearchSelectedItemMenu)
  subscriptionSearchSelectedItemMenu
    .back('⬅️ Back', (ctx) => {
      ctx.editMessageText('Results:')
    })

  subscriptionSearchMenu.register(subscriptionSearchSelectedItemMenu)
  bot.use(subscriptionSearchMenu)

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.session.subscription.isAwaitsSearchQuery) return next()
    ctx.session.subscription.isAwaitsSearchQuery = false

    const query = ctx.message.text
    await ctx.reply(`Loading...`)
    ctx.session.subscription.searchResults = await search(query)
    if (ctx.session.subscription.searchResults.length === 0) {
      await ctx.reply('Empty search results')
    } else {
      await ctx.reply('Results:', {
        reply_markup: subscriptionSearchMenu
      })
    }
  })

  const getFormattedSubscriptions = async () => Object.values(await getSubscriptions())
    .map(i => i.title)
    .join(('\n\n')) || 'You have not any subscriptions'

  const showSubscriptions = async (ctx: BotContext) => {
    ctx.reply(
      await getFormattedSubscriptions(),
      {
        reply_markup: subscriptionMenu
      }
    )
  }

  return showSubscriptions
}
