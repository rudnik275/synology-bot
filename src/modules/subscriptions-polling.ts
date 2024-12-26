import type {BotContext, TvShowDetailed} from '../types.ts'
import {Bot} from 'grammy'
import {getSubscriptions, updateSubscriptions} from '../utils/subscriptions-db.ts'
import {findNextEpisode, isEpisodeToday} from '../utils/format-subscriptions.ts'
import {loadTvShow} from '../utils/subscriptions-api.ts'

export function registerSubscriptionsPolling(bot: Bot<BotContext>) {
  const now = new Date()
  let delay =
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).getTime() -
    now.getTime()

  if (delay < 0) {
    // If the delay is negative (current time is past 9:00 AM), add 24 hours to schedule for the next day
    delay += 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  }

  setTimeout(async () => {
    await checkDailyUpdates()
    setInterval(checkDailyUpdates, 24 * 60 * 60 * 1000) // 24 hours
  }, delay)

  const checkDailyUpdates = async () => {
    const showsWithNewEpisodes: TvShowDetailed[] = []
    const subscriptions = await getSubscriptions()
    for (const subscription of Object.values(subscriptions)) {
      const updatedSubscription = await loadTvShow(subscription.id)
      subscriptions[subscription.id] = updatedSubscription
      const nextEpisode = findNextEpisode(updatedSubscription)
      if (nextEpisode && isEpisodeToday(nextEpisode.airDate)) {
        showsWithNewEpisodes.push(updatedSubscription)
      }
    }
    await sendUpdates(showsWithNewEpisodes)
    await updateSubscriptions(subscriptions)
  }

  const sendUpdates = async (tvShows: TvShowDetailed[]) => {
    if (!chatId) return
    if (tvShows.length === 0) return

    bot.api.sendMessage(
      chatId,
      tvShows.map(tvShow => `${tvShow.title} (${
        findNextEpisode(tvShow)!.shortName
      })`).join('\n\n')
    )
  }

  let chatId: number
  bot.on('message', (ctx, next) => {
    chatId = ctx.chat.id
    return next()
  })
}
