import { loadConfig } from './config.ts'
import { PersistentStore } from './infra/persistence/store.ts'
import { SynologyClient } from './infra/synology/client.ts'
import { DockerClient } from './infra/docker/client.ts'
import { TaskMonitor } from './domain/task-monitor/task-monitor.ts'
import { Notifier } from './domain/notifier/notifier.ts'
import { createBot } from './bot.ts'
import { ReachabilityMonitor } from './domain/reachability-monitor.ts'
import { migrateJsonSubscriptions } from './infra/migration/subscriptions-migration.ts'
import { runDigest, scheduleDailyDigest } from './domain/digest-scheduler.ts'
import { getTodayEpisodes } from './infra/myshows/client.ts'
import { DiskUsageWatcher } from './domain/disk-usage-watcher.ts'
import { DiskHealthWatcher } from './domain/disk-health-watcher.ts'

export async function startApp(): Promise<void> {
  const config = loadConfig()
  const store = new PersistentStore(config.dbPath)
  const synology = new SynologyClient(config.synology)
  const docker = new DockerClient({ socketPath: config.dockerSocketPath })

  // One-time migration from legacy JSON file
  await migrateJsonSubscriptions(store, './db/data.json')

  // Pre-login so the first /ping-nas is fast
  try {
    await synology.login()
  } catch (err) {
    console.warn('Initial Synology login failed — will retry on demand:', err)
  }

  const bot = createBot({ config, store, synology, docker })

  // Register bot commands for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'ping-nas', description: 'Проверить связь с NAS' },
    { command: 'health', description: 'Состояние NAS (CPU, RAM, диск)' },
    { command: 'deploy-status', description: 'Статус Watchtower / деплоя' },
    { command: 'subscribe', description: 'Подписаться на шоу' },
    { command: 'subscriptions', description: 'Список подписок' },
    { command: 'unsubscribe', description: 'Отписаться от шоу' },
  ])

  // Start NAS reachability watcher (background loop)
  startReachabilityWatcher({ config, store, synology, bot })

  // Start disk usage watcher (background loop)
  startDiskUsageWatcher({ config, store, synology, bot })

  // Start disk health watcher (background loop)
  startDiskHealthWatcher({ config, store, synology, bot })

  // Schedule daily 9 AM digest
  scheduleDailyDigest(async () => {
    const subscriptions = store.listSubscriptions()
    const ownerChatId = store.getKv('owner_chat_id')
    await runDigest({
      subscriptions,
      ownerChatId,
      fetchTodayEpisodes: getTodayEpisodes,
      sendMessage: async (chatId, message) => {
        await bot.api.sendMessage(chatId, message)
      },
      onSubscriptionUpdated: async (updated) => {
        store.addSubscription(updated)
      },
    })
  })

  // Set up TaskMonitor + Notifier -- runs as a background polling loop
  const notifier = new Notifier(store, async (chatId, text) => {
    await bot.api.sendMessage(chatId, text)
  })

  const getTasks = async () => {
    const result = await synology.listTasks()
    if (!result.ok) {
      throw new Error(result.reason)
    }
    return result.data
  }

  const taskMonitor = new TaskMonitor(getTasks, notifier.asCallback(), store)

  // Start bot first, then begin polling loops
  const botPromise = bot.start()

  console.log(`[TaskMonitor] Starting polling every ${config.pollIntervalMs}ms`)
  taskMonitor.start(config.pollIntervalMs)

  await botPromise
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
          console.warn(`[ReachabilityWatcher] No owner_chat_id in store -- cannot send ${event}`)
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

function startDiskUsageWatcher({
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
  const watcher = new DiskUsageWatcher({
    getStorageInfo: () => synology.getStorageInfo(),
    isVolumeWarned: async (volumeId) => store.wasHealthFired('disk_full', volumeId),
    markWarned: async (volumeId) => store.markHealthFired('disk_full', volumeId),
    clearWarned: async (volumeId) => store.clearHealthFired('disk_full', volumeId),
    notify: async (message) => {
      const ownerChatId = store.getKv('owner_chat_id')
      if (!ownerChatId) {
        console.warn('[DiskUsageWatcher] No owner_chat_id in store — cannot send notification')
        return
      }
      await bot.api.sendMessage(ownerChatId, message)
    },
    highPct: config.diskFullHighPct,
    lowPct: config.diskFullLowPct,
  })

  const pollIntervalMs = config.diskUsagePollMs

  const loop = async (): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      try {
        await watcher.check()
      } catch (err) {
        console.error('[DiskUsageWatcher] Unexpected error in poll:', err)
      }
    }
  }

  // Fire-and-forget: background loop, errors are logged not thrown
  loop().catch((err) => {
    console.error('[DiskUsageWatcher] Loop crashed:', err)
  })
}

function startDiskHealthWatcher({
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
  const watcher = new DiskHealthWatcher({
    getDiskInfo: () => synology.getDiskInfo(),
    getState: (event, resourceId) => {
      if (store.wasHealthFired(event, resourceId)) {
        // Determine the active state from the event name
        if (event === 'disk_temp') return 'hot'
        if (event === 'disk_smart') return 'warn'
      }
      return 'ok'
    },
    setState: (event, resourceId, state) => {
      if (state === 'ok') {
        store.clearHealthFired(event, resourceId)
      } else {
        store.markHealthFired(event, resourceId)
      }
    },
    notify: async (message) => {
      const ownerChatId = store.getKv('owner_chat_id')
      if (!ownerChatId) {
        console.warn(`[DiskHealthWatcher] No owner_chat_id in store — cannot send: ${message}`)
        return
      }
      await bot.api.sendMessage(ownerChatId, message)
    },
    tempHigh: config.diskTempHighC,
    tempLow: config.diskTempLowC,
  })

  const pollIntervalMs = config.diskHealthPollMs

  const loop = async (): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      await watcher.check()
    }
  }

  // Fire-and-forget: background loop, errors logged inside watcher.check()
  loop().catch((err) => {
    console.error('[DiskHealthWatcher] Loop crashed:', err)
  })
}
