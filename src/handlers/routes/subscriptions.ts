import type { Bot, Context } from 'grammy'
import type { PersistentStore } from '../../infra/persistence/store.ts'
import { getShowById } from '../../infra/myshows/client.ts'
import type { Subscription } from '../../domain/subscription.ts'

export function registerSubscriptionRoutes(bot: Bot<Context>, store: PersistentStore): void {
  // /subscribe <showId> — subscribe to a show by myshows.me show id
  bot.command('subscribe', async (ctx) => {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? []
    const rawId = args[0]

    if (!rawId || isNaN(Number(rawId))) {
      await ctx.reply('❗ Использование: /subscribe <showId>')
      return
    }

    const showId = Number(rawId)

    // Check if already subscribed
    const existing = store.getSubscription(String(showId))
    if (existing) {
      await ctx.reply(`✅ Вы уже подписаны на «${existing.title}»`)
      return
    }

    let title: string
    try {
      const show = await getShowById(showId)
      title = show.title
    } catch {
      await ctx.reply('❌ Не удалось получить информацию о шоу. Проверьте showId.')
      return
    }

    const sub: Subscription = { id: String(showId), showId, title }
    store.addSubscription(sub)

    await ctx.reply(`✅ Подписка оформлена: «${title}»`)
  })

  // /subscriptions — list all current subscriptions
  bot.command('subscriptions', async (ctx) => {
    const subs = store.listSubscriptions()

    if (subs.length === 0) {
      await ctx.reply('📋 Нет активных подписок.')
      return
    }

    const lines = subs.map((s, i) => `${i + 1}. ${s.title} (id: ${s.id})`)
    await ctx.reply(`📋 Ваши подписки:\n${lines.join('\n')}`)
  })

  // /unsubscribe <id> — remove subscription by id (showId)
  bot.command('unsubscribe', async (ctx) => {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? []
    const rawId = args[0]

    if (!rawId) {
      await ctx.reply('❗ Использование: /unsubscribe <id>')
      return
    }

    const existing = store.getSubscription(rawId)
    if (!existing) {
      await ctx.reply(`❌ Подписка с id «${rawId}» не найдена.`)
      return
    }

    store.removeSubscription(rawId)
    await ctx.reply(`✅ Подписка на «${existing.title}» удалена.`)
  })
}
