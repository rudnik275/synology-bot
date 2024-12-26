import type {BotContext} from '../types.ts'
import {Bot} from 'grammy'
import {getSubscriptions} from '../utils/subscriptions-db.ts'
import {formatSubscription} from '../utils/format-subscriptions.ts'

export function registerSubscriptionsPolling(bot: Bot<BotContext>) {
  const getFormattedSubscriptions = async () => Object.values(await getSubscriptions())
    .map(formatSubscription)
    .join(('\n\n')) || 'You have not any subscriptions'

  let chatId: number
  const sendDailyUpdates = async () => {
    if (!chatId) return

    bot.api.sendMessage(
      chatId,
      await getFormattedSubscriptions(), // TODO: check each subscription and send correct updates. Only when have some news
    )
  }

  const ONE_DAY = 24 * 60 * 60 * 1000
  const now = new Date()
  const delay =
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).getTime() -
    now.getTime()
  setTimeout(() => {
    sendDailyUpdates()
    setInterval(sendDailyUpdates, ONE_DAY) // 24 часа
  }, delay)

  bot.on('message', (ctx, next) => {
    chatId = ctx.chat.id
    next()
  })
}
