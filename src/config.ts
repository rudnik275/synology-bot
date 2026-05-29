function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function requiredInt(name: string): number {
  const raw = required(name)
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer (got: "${raw}")`)
  }
  return parsed
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

export interface Config {
  botToken: string
  ownerChatId: number
  synology: {
    host: string
    user: string
    password: string
  }
  toloka: {
    username: string
    password: string
    baseUrl: string
  }
  dbPath: string
  nasReachabilityPollMs: number
  nasDownDebounceCount: number
  dockerSocketPath: string
  diskUsagePollMs: number
  diskFullHighPct: number
  diskFullLowPct: number
  pollIntervalMs: number
  diskHealthPollMs: number
  finishedDebounceMs: number
  finishedGroupThreshold: number
  autoCleanerPollMs: number
  autoCleanerRetentionDays: number
  miniappPort: number
  miniappUrl: string
}

export function loadConfig(): Config {
  return {
    botToken: required('BOT_TOKEN'),
    ownerChatId: requiredInt('OWNER_CHAT_ID'),
    synology: {
      host: required('SYNOLOGY_HOST'),
      user: required('SYNOLOGY_USER'),
      password: required('SYNOLOGY_PASSWORD'),
    },
    toloka: {
      username: optional('TOLOKA_USERNAME'),
      password: optional('TOLOKA_PASSWORD'),
      baseUrl: optional('TOLOKA_BASE_URL', 'https://toloka.to'),
    },
    dbPath: optional('DB_PATH', './data/bot.db'),
    nasReachabilityPollMs: parseInt(optional('NAS_REACHABILITY_POLL_MS', '60000'), 10),
    nasDownDebounceCount: parseInt(optional('NAS_DOWN_DEBOUNCE_COUNT', '3'), 10),
    dockerSocketPath: optional('DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
    diskUsagePollMs: parseInt(optional('DISK_USAGE_POLL_MS', '600000'), 10),
    diskFullHighPct: parseInt(optional('DISK_FULL_HIGH_PCT', '90'), 10),
    diskFullLowPct: parseInt(optional('DISK_FULL_LOW_PCT', '85'), 10),
    pollIntervalMs: parseInt(optional('POLL_INTERVAL_MS', '30000'), 10),
    diskHealthPollMs: parseInt(optional('DISK_HEALTH_POLL_MS', '600000'), 10),
    finishedDebounceMs: parseInt(optional('FINISHED_DEBOUNCE_MS', '60000'), 10),
    finishedGroupThreshold: parseInt(optional('FINISHED_GROUP_THRESHOLD', '3'), 10),
    autoCleanerPollMs: parseInt(optional('AUTOCLEANER_POLL_MS', '3600000'), 10),
    autoCleanerRetentionDays: parseInt(optional('AUTOCLEANER_RETENTION_DAYS', '7'), 10),
    miniappPort: parseInt(optional('MINIAPP_PORT', '8080'), 10),
    miniappUrl: optional('MINIAPP_URL', ''),
  }
}
