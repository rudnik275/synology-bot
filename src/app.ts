import { loadConfig } from './config.ts'
import { PersistentStore } from './infra/persistence/store.ts'
import { SynologyClient } from './infra/synology/client.ts'
import { createBot } from './bot.ts'

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

  await bot.start()
}
