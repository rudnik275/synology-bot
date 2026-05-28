import { loadConfig } from './config.ts'
import { PersistentStore } from './infra/persistence/store.ts'
import { SynologyClient } from './infra/synology/client.ts'
import { DockerClient } from './infra/docker/client.ts'
import { TaskMonitor } from './domain/task-monitor/task-monitor.ts'
import { Notifier } from './domain/notifier/notifier.ts'
import { FinishedDebouncer } from './domain/finished-debouncer.ts'
import { StuckDetector } from './domain/stuck-detector.ts'
import { FailedDetector } from './domain/failed-detector.ts'
import { createBot } from './bot.ts'
import { ReachabilityMonitor } from './domain/reachability-monitor.ts'
import { migrateJsonSubscriptions } from './infra/migration/subscriptions-migration.ts'
import { runDigest, scheduleDailyDigest } from './domain/digest-scheduler.ts'
import { getTodayEpisodes } from './infra/myshows/client.ts'
import { DiskUsageWatcher } from './domain/disk-usage-watcher.ts'
import { DiskHealthWatcher } from './domain/disk-health-watcher.ts'
import { AutoCleaner } from './domain/auto-cleaner.ts'
import { buildTaskActionKeyboard } from './handlers/routes/task-actions.ts'
import { OwnerNotifier } from './infra/notify/owner-notifier.ts'
import { createServer } from './server/server.ts'
import { DeployReporter } from './domain/deploy-reporter.ts'
import pkg from '../package.json' with { type: 'json' }

export async function startApp(): Promise<void> {
  const config = loadConfig()
  const store = new PersistentStore(config.dbPath)
  const synology = new SynologyClient(config.synology)
  const docker = new DockerClient({ socketPath: config.dockerSocketPath })

  // One-time migration from legacy JSON file
  await migrateJsonSubscriptions(store, './db/data.json')

  // We know owner_chat_id from env at boot — seed it so OwnerNotifier works
  // before the owner even talks to the bot. Otherwise watchers fire into the
  // void during the first session.
  if (!store.getKv('owner_chat_id')) {
    store.setKv('owner_chat_id', String(config.ownerChatId))
  }

  // Pre-login so the first /ping_nas is fast
  try {
    await synology.login()
  } catch (err) {
    console.warn('Initial Synology login failed — will retry on demand:', err)
  }

  const bot = createBot({ config, store, synology, docker })

  // Register bot commands for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'ping_nas', description: 'Проверить связь с NAS' },
    { command: 'health', description: 'Состояние NAS (CPU, RAM, диск)' },
    { command: 'deploy_status', description: 'Статус Watchtower / деплоя' },
    { command: 'subscribe', description: 'Подписаться на шоу' },
    { command: 'subscriptions', description: 'Список подписок' },
    { command: 'unsubscribe', description: 'Отписаться от шоу' },
    { command: 'dashboard', description: 'Активные задачи (авто-обновление)' },
  ])

  // Single notification surface — all owner-bound push messages go here.
  const ownerNotifier = new OwnerNotifier(store, async ({ chatId, text, replyMarkup }) => {
    await bot.api.sendMessage(chatId, text, {
      reply_markup: replyMarkup,
    })
  })

  // Background watchers
  startReachabilityWatcher({ config, store, synology, ownerNotifier })
  startDiskUsageWatcher({ config, store, synology, ownerNotifier })
  startDiskHealthWatcher({ config, store, synology, ownerNotifier })

  // One-shot deploy reporter: detects if our image SHA changed since last
  // boot (i.e. Watchtower just deployed us) and posts to #deploy.
  await runDeployReporter({ docker, store, ownerNotifier })

  // Schedule daily 9 AM digest
  scheduleDailyDigest(async () => {
    const subscriptions = store.listSubscriptions()
    const ownerChatId = store.getKv('owner_chat_id')
    await runDigest({
      subscriptions,
      ownerChatId,
      fetchTodayEpisodes: getTodayEpisodes,
      sendMessage: async (_chatId, message) => {
        await ownerNotifier.send('subscriptions', message)
      },
      onSubscriptionUpdated: async (updated) => {
        store.addSubscription(updated)
      },
    })
  })

  // TaskMonitor + Notifier + detectors — background polling loop
  const notifier = new Notifier(ownerNotifier)

  const debouncer = new FinishedDebouncer({
    windowMs: config.finishedDebounceMs,
    threshold: config.finishedGroupThreshold,
    flushIndividual: (task) => notifier.notify(task),
    flushGrouped: (tasks) => notifier.notifyFinishedGrouped(tasks),
  })

  const getTasks = async () => {
    const result = await synology.listTasks()
    if (!result.ok) {
      throw new Error(result.reason)
    }
    return result.data
  }

  const stuckDetector = new StuckDetector({
    zeroSpeedThresholdMs: 5 * 60 * 1000,
    store,
    sendAlert: async ({ text, taskId }) => {
      await ownerNotifier.send('torrents', text, {
        replyMarkup: buildTaskActionKeyboard(taskId),
      })
    },
  })

  const failedDetector = new FailedDetector({
    store,
    sendAlert: async ({ text, taskId }) => {
      await ownerNotifier.send('torrents', text, {
        replyMarkup: buildTaskActionKeyboard(taskId),
      })
    },
  })

  const taskMonitor = new TaskMonitor(
    getTasks,
    (task) => {
      debouncer.enqueue(task)
      return Promise.resolve()
    },
    store,
    [stuckDetector, failedDetector]
  )

  // Mini App backend (ADR 0005) — JSON API over the infra layer, bound to
  // loopback only; reached from outside via a Cloudflare Tunnel on the NAS.
  const server = createServer({
    synology,
    botToken: config.botToken,
    ownerId: config.ownerChatId,
  })
  Bun.serve({ port: config.miniappPort, hostname: '127.0.0.1', fetch: server.fetch })
  console.log(`[server] Mini App API on http://127.0.0.1:${config.miniappPort}`)

  // Start bot first, then begin polling loops
  const botPromise = bot.start()

  console.log(`[TaskMonitor] Starting polling every ${config.pollIntervalMs}ms`)
  taskMonitor.start(config.pollIntervalMs)

  // Start AutoCleaner background loop
  startAutoCleaner({ config, store, synology, ownerNotifier })

  await botPromise
}

interface WatcherDeps {
  config: ReturnType<typeof loadConfig>
  store: PersistentStore
  synology: SynologyClient
  ownerNotifier: OwnerNotifier
}

function startReachabilityWatcher({ config, store, synology, ownerNotifier }: WatcherDeps): void {
  const monitor = new ReachabilityMonitor(
    {
      checkReachability: () => synology.isReachable(),
      onEvent: async (event, reason) => {
        if (event === 'nas.down') {
          await ownerNotifier.send('health', `❌ NAS недоступен${reason ? ` — ${reason}` : ''}`)
          store.markHealthFired('nas_down', 'nas')
        } else if (event === 'nas.recovered') {
          await ownerNotifier.send('health', '✅ NAS снова доступен')
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
  loop().catch((err) => console.error('[ReachabilityWatcher] Loop crashed:', err))
}

function startDiskUsageWatcher({ config, store, synology, ownerNotifier }: WatcherDeps): void {
  const watcher = new DiskUsageWatcher({
    getStorageInfo: () => synology.getStorageInfo(),
    isVolumeWarned: async (volumeId) => store.wasHealthFired('disk_full', volumeId),
    markWarned: async (volumeId) => store.markHealthFired('disk_full', volumeId),
    clearWarned: async (volumeId) => store.clearHealthFired('disk_full', volumeId),
    notify: (message) => ownerNotifier.send('health', message),
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
  loop().catch((err) => console.error('[DiskUsageWatcher] Loop crashed:', err))
}

function startDiskHealthWatcher({ config, store, synology, ownerNotifier }: WatcherDeps): void {
  const watcher = new DiskHealthWatcher({
    getDiskInfo: () => synology.getDiskInfo(),
    getState: (event, resourceId) => {
      if (store.wasHealthFired(event, resourceId)) {
        if (event === 'disk_temp') return 'hot'
        if (event === 'disk_smart') return 'warn'
      }
      return 'ok'
    },
    setState: (event, resourceId, state) => {
      if (state === 'ok') store.clearHealthFired(event, resourceId)
      else store.markHealthFired(event, resourceId)
    },
    notify: (message) => ownerNotifier.send('health', message),
  })

  const pollIntervalMs = config.diskHealthPollMs
  const loop = async (): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      await watcher.check()
    }
  }
  loop().catch((err) => console.error('[DiskHealthWatcher] Loop crashed:', err))
}

function startAutoCleaner({ config, store, synology, ownerNotifier }: WatcherDeps): void {
  const cleaner = new AutoCleaner({
    getCompleted: (cutoffMs) => Promise.resolve(store.getCompletedBefore(cutoffMs)),
    deleteTask: (taskId) => synology.deleteTask(taskId),
    removeCompletion: (taskId) => { store.removeCompletion(taskId); return Promise.resolve() },
    notify: (message) => ownerNotifier.send('torrents', message),
    retentionDays: config.autoCleanerRetentionDays,
    now: () => Date.now(),
  })

  const pollIntervalMs = config.autoCleanerPollMs
  const loop = async (): Promise<void> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      try {
        await cleaner.cleanup()
      } catch (err) {
        console.error('[AutoCleaner] Unexpected error in cleanup tick:', err)
      }
    }
  }
  console.log(`[AutoCleaner] Starting cleanup loop every ${pollIntervalMs}ms (retention: ${config.autoCleanerRetentionDays} days)`)
  loop().catch((err) => console.error('[AutoCleaner] Loop crashed:', err))
}

async function runDeployReporter({
  docker,
  store,
  ownerNotifier,
}: {
  docker: DockerClient
  store: PersistentStore
  ownerNotifier: OwnerNotifier
}): Promise<void> {
  const reporter = new DeployReporter({
    getOwnImageId: async () => {
      const container = await docker.getContainerByName('synology-bot')
      return container?.imageId ?? ''
    },
    getLastImageId: () => store.getKv('bot_image_sha'),
    setLastImageId: (sha) => store.setKv('bot_image_sha', sha),
    version: pkg.version,
    notify: (message) => ownerNotifier.send('deploy', message),
  })
  await reporter.report()
}
