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
import { registerTaskActionsRoute } from './handlers/routes/task-actions.ts'
import { registerTorrentIntakeRoute, registerUriIntakeRoute } from './handlers/routes/torrent-intake.ts'

export interface BotDeps {
  config: Config
  store: PersistentStore
  synology: SynologyClient
  docker: DockerClient
}

// Thin notifier bot (ADR 0005): keeps /start + diagnostic commands + push-alert
// action buttons (task-actions). Management (search, dashboard, folder picker)
// lives in the Mini App. The bot keeps a narrow, stateless add-intake handoff
// surface (ADR 0008): a forwarded .torrent (#99) or a magnet/URL pasted as text
// (#120) is stashed and deep-linked into the Mini App wizard — never a task in chat.
export function createBot(deps: BotDeps): Bot<Context> {
  const bot = new Bot<Context>(deps.config.botToken)

  // Owner-only guard — all subsequent handlers run only for Owner
  bot.use(createOwnerOnlyMiddleware(deps.config.ownerChatId, deps.store))

  // Routes
  registerStartRoute(bot)
  registerPingNasRoute(bot, deps.synology)
  registerHealthRoute(bot, deps.synology)
  registerDeployStatusRoute(bot, deps.docker)
  registerSubscriptionRoutes(bot, deps.store)
  registerTaskActionsRoute(bot, deps.synology)
  // #99 — accept a forwarded .torrent and hand it to the Mini App by token.
  registerTorrentIntakeRoute(bot, {
    store: deps.store,
    botToken: deps.config.botToken,
    miniappUrl: deps.config.miniappUrl,
  })
  // #120 — accept a magnet / URL pasted as text and hand it off the same way.
  // Registered after the command routes so /commands aren't swallowed; the
  // matcher ignores ordinary text, so only links trigger a handoff.
  registerUriIntakeRoute(bot, {
    store: deps.store,
    miniappUrl: deps.config.miniappUrl,
  })

  return bot
}
