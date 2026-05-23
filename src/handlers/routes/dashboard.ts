import type { Bot, Context } from 'grammy'
import type { LiveDashboard } from '../flows/live-dashboard.ts'

/**
 * Registers the /dashboard command.
 * Calling /dashboard again replaces (stops + restarts) any existing dashboard.
 */
export function registerDashboardRoute(bot: Bot<Context>, dashboard: LiveDashboard): void {
  bot.command('dashboard', async (ctx) => {
    await dashboard.start(ctx)
  })
}
