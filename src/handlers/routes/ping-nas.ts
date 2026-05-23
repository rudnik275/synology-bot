import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'

export function registerPingNasRoute(bot: Bot<Context>, synology: SynologyClient): void {
  bot.command('ping-nas', async (ctx) => {
    const result = await synology.isReachable()

    if (result.ok) {
      await ctx.reply('✅ NAS reachable')
    } else {
      try {
        await ctx.react('👎')
      } catch {
        // Fallback if reaction API is unavailable
      }
      await ctx.reply(`❌ NAS down — ${result.reason}`)
    }
  })
}
