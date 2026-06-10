import { Bot, GrammyError, type BotError, type Context } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
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

// Expected Telegram API errors that handlers can run into through ordinary
// user behavior (double-taps, stale buttons after a restart, edits of long-gone
// messages). These must never crash the process (#290).
const TOLERATED_API_ERRORS = [
  'message is not modified',
  'query is too old',
  'message to edit not found',
]

/** True for GrammyError cases we deliberately swallow in bot.catch (#290). */
export function isToleratedApiError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    TOLERATED_API_ERRORS.some((needle) => error.description.includes(needle))
  )
}

/**
 * Global error boundary (#290). Without bot.catch, grammY's default handler
 * re-throws, which rejects bot.start() — awaited in app.ts — and kills the
 * whole process on the first handler error.
 */
export function handleBotError(err: BotError<Context>): void {
  const update = err.ctx.update
  const updateType = Object.keys(update).filter((k) => k !== 'update_id').join(', ')
  if (isToleratedApiError(err.error)) {
    console.warn(
      `[bot] tolerated Telegram API error (update ${update.update_id}, ${updateType}): ${(err.error as GrammyError).description}`
    )
    return
  }
  console.error(`[bot] handler error (update ${update.update_id}, ${updateType}):`, err.error)
}

/**
 * Catch-all for callback queries no route matched (#297) — e.g. dash_action:*
 * buttons on old dashboard messages from a removed feature. Without an answer
 * Telegram shows a ~30s spinner; instead we toast that the button is stale.
 * Must be registered AFTER all real callback_query routes.
 */
export function registerStaleCallbackFallback(bot: Bot<Context>): void {
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Кнопка устарела' })
  })
}

// Thin notifier bot (ADR 0005): keeps /start + diagnostic commands + push-alert
// action buttons (task-actions). Management (search, dashboard, folder picker)
// lives in the Mini App. The bot keeps a narrow, stateless add-intake handoff
// surface (ADR 0008): a forwarded .torrent (#99) or a magnet/URL pasted as text
// (#120) is stashed and deep-linked into the Mini App wizard — never a task in chat.
export function createBot(deps: BotDeps): Bot<Context> {
  const bot = new Bot<Context>(deps.config.botToken)

  // #298 — honor Telegram's retry_after on 429s for ALL API calls made through
  // this bot's api instance, including OwnerNotifier pushes in app.ts.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }))

  // Owner-only guard — all subsequent handlers run only for Owner
  bot.use(createOwnerOnlyMiddleware(deps.config.ownerChatId, deps.store))

  // Routes
  registerStartRoute(bot)
  registerPingNasRoute(bot, deps.synology)
  registerHealthRoute(bot, deps.synology)
  registerDeployStatusRoute(bot, deps.docker)
  registerSubscriptionRoutes(bot, deps.store)
  registerTaskActionsRoute(bot, {
    synology: deps.synology,
    // #301 — a resumed task must be able to re-alert if it fails/sticks again.
    clearNotifFired: (taskId, event) => deps.store.clearNotifFired(taskId, event),
  })
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

  // #297 — after every callback route: answer anything unmatched.
  registerStaleCallbackFallback(bot)

  // #290 — never let a handler error propagate out of bot.start().
  bot.catch(handleBotError)

  return bot
}
