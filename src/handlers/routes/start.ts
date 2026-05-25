import type { Bot, Context } from 'grammy'

export function registerStartRoute(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    await ctx.reply('👋 Бот готов. Используй /ping_nas для проверки связи с NAS.')
  })
}
