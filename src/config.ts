function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

export interface Config {
  botToken: string
  ownerUsername: string
  synology: {
    host: string
    user: string
    password: string
  }
  toloka: {
    username: string
    password: string
    baseUrl: string
    playwrightEnabled: boolean
    userAgent?: string
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
  dashboardRefreshMs: number
  dashboardAutostopMs: number
  autoCleanerPollMs: number
  autoCleanerRetentionDays: number
}

export function loadConfig(): Config {
  return {
    botToken: required('BOT_TOKEN'),
    ownerUsername: required('OWNER_USERNAME'),
    synology: {
      host: required('SYNOLOGY_HOST'),
      user: required('SYNOLOGY_USER'),
      password: required('SYNOLOGY_PASSWORD'),
    },
    toloka: {
      username: optional('TOLOKA_USERNAME'),
      password: optional('TOLOKA_PASSWORD'),
      baseUrl: optional('TOLOKA_BASE_URL', 'https://toloka.to'),
      playwrightEnabled: optional('TOLOKA_PLAYWRIGHT_ENABLED', 'true') !== 'false',
      userAgent: process.env['TOLOKA_USER_AGENT'] || undefined,
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
    dashboardRefreshMs: parseInt(optional('DASHBOARD_REFRESH_MS', '5000'), 10),
    dashboardAutostopMs: parseInt(optional('DASHBOARD_AUTOSTOP_MS', '120000'), 10),
    autoCleanerPollMs: parseInt(optional('AUTOCLEANER_POLL_MS', '3600000'), 10),
    autoCleanerRetentionDays: parseInt(optional('AUTOCLEANER_RETENTION_DAYS', '7'), 10),
  }
}
