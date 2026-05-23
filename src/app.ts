import { loadConfig } from './config.ts'
import { PersistentStore } from './infra/persistence/store.ts'
import { SynologyClient } from './infra/synology/client.ts'
import { createBot } from './bot.ts'
import { ReachabilityMonitor } from './domain/reachability-monitor.ts'

export async function startApp(): Promise<void> {
  const config = loadConfig()
  const store = new PersistentStore(config.dbPath)
  const synology = new SynologyClient(config.synology)

  // Pre-login so the first /ping-nas is fast
  try {
    await synology.login()
  } catch (err) {
    console.warn('Initial Synology login failed — will retry on demand:', err)
  }

  const bot = createBot({ config, store, synology })

  // Register bot commands for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'ping-nas', description: 'Проверить связь с NAS' },
  ])

  // Start NAS reachability watcher (background loop)
  startReachabilityWatcher({ config, store, synology, bot })

  await bot.start()
}

function startReachabilityWatcher({
  config,
  store,
  synology,
  bot,
}: {
  config: ReturnType<typeof loadConfig>
  store: PersistentStore
  synology: SynologyClient
  bot: ReturnType<typeof createBot>
}): void {
  const monitor = new ReachabilityMonitor(
    {
      checkReachability: () => synology.isReachable(),
      onEvent: async (event, reason) => {
        const ownerChatId = store.getKv('owner_chat_id')
        if (!ownerChatId) {
          console.warn(`[ReachabilityWatcher] No owner_chat_id in store — cannot send ${event}`)
          return
        }

        if (event === 'nas.down') {
          const msg = `❌ NAS недоступен${reason ? ` — ${reason}` : ''}`
          await bot.api.sendMessage(ownerChatId, msg)
          store.markHealthFired('nas_down', 'nas')
        } else if (event === 'nas.recovered') {
          await bot.api.sendMessage(ownerChatId, '✅ NAS снова доступен')
          store.clearHealthFired('nas_down', 'nas')
        }
      },
      getState: () => store.getNasState(),
      setState: (state) => store.setNasState(state),
    },
    { debounceCount: config.nasDownDebounceCount }
  )

  const pollIntervalMs = config.nasReachabilityPollMs

  const loop = async (): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      try {
        await monitor.poll()
      } catch (err) {
        console.error('[ReachabilityWatcher] Unexpected error in poll:', err)
      }
    }
  }

  // Fire-and-forget: background loop, errors are logged not thrown
  loop().catch((err) => {
    console.error('[ReachabilityWatcher] Loop crashed:', err)
  })
}
