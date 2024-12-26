import {Bot} from 'grammy'
import type {BotContext, TvShowDetailed} from '../types.ts'
import {Menu} from '@grammyjs/menu'
import {loadTvShow, search} from '../utils/subscriptions-api.ts'
import {formatSubscription, formatTvShowDetailed} from '../utils/format-subscriptions.ts'
import {getSubscriptions, updateSubscriptions} from '../utils/subscriptions-db.ts'


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
          .submenu(formatSubscription(subscription), 'selectedActiveSubscriptionMenu', async (ctx) => {
            ctx.session.subscription.selectedItem = subscription
            const tvShow: TvShowDetailed = await loadTvShow(subscription.id)
            ctx.editMessageText(formatTvShowDetailed(tvShow))
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
          .submenu(formatSubscription(item), 'subscriptionSearchSelectedItemMenu', async (ctx) => {
            ctx.session.subscription.selectedItem = item
            const tvShow: TvShowDetailed = await loadTvShow(item.id)
            ctx.editMessageText(formatTvShowDetailed(tvShow))
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
    .map(formatSubscription)
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
