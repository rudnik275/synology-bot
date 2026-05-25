import { Bot, type Context } from 'grammy'
import type { PersistentStore } from './infra/persistence/store.ts'
import type { SynologyClient } from './infra/synology/client.ts'
import type { DockerClient } from './infra/docker/client.ts'
import type { Config } from './config.ts'
import { createOwnerOnlyMiddleware } from './handlers/middleware/owner-only.ts'
import { registerStartRoute } from './handlers/routes/start.ts'
import { registerPingNasRoute } from './handlers/routes/ping-nas.ts'
import { registerHealthRoute } from './handlers/routes/health.ts'
import { registerDeployStatusRoute } from './handlers/routes/deploy-status.ts'
import { registerSubscriptionRoutes } from './handlers/routes/subscriptions.ts'
import { registerInputRouter } from './handlers/input-router.ts'
import { registerSearchRoute } from './handlers/routes/search.ts'
import { registerDashboardRoute } from './handlers/routes/dashboard.ts'
import { registerDashboardActions } from './handlers/routes/dashboard-actions.ts'
import { LiveDashboard } from './handlers/flows/live-dashboard.ts'
import { registerTaskActionsRoute } from './handlers/routes/task-actions.ts'
import { TolokaClient } from './infra/toloka/client.ts'

export interface BotDeps {
  config: Config
  store: PersistentStore
  synology: SynologyClient
  docker: DockerClient
}

export function createBot(deps: BotDeps): Bot<Context> {
  const bot = new Bot<Context>(deps.config.botToken)

  // Owner-only guard — all subsequent handlers run only for Owner
  bot.use(createOwnerOnlyMiddleware(deps.config.ownerChatId, deps.store))

  // Toloka client
  const toloka = new TolokaClient(
    {
      username: deps.config.toloka.username,
      password: deps.config.toloka.password,
      baseUrl: deps.config.toloka.baseUrl,
    },
    deps.store
  )

  // LiveDashboard — singleton per chat, in-memory, not persisted
  const liveDashboard = new LiveDashboard(deps.synology, deps.config.dashboardRefreshMs, deps.config.dashboardAutostopMs)

  // Routes
  registerStartRoute(bot)
  registerPingNasRoute(bot, deps.synology)
  registerHealthRoute(bot, deps.synology)
  registerDeployStatusRoute(bot, deps.docker)
  registerSubscriptionRoutes(bot, deps.store)
  registerInputRouter(bot, deps.synology, toloka)
  registerSearchRoute(bot, toloka, deps.synology)
  registerDashboardRoute(bot, liveDashboard)
  registerDashboardActions(bot, deps.synology, liveDashboard)
  registerTaskActionsRoute(bot, deps.synology)

  return bot
}
