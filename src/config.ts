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
  }
  dbPath: string
  nasReachabilityPollMs: number
  nasDownDebounceCount: number
  dockerSocketPath: string
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
    },
    dbPath: optional('DB_PATH', './data/bot.db'),
    nasReachabilityPollMs: parseInt(optional('NAS_REACHABILITY_POLL_MS', '60000'), 10),
    nasDownDebounceCount: parseInt(optional('NAS_DOWN_DEBOUNCE_COUNT', '3'), 10),
    dockerSocketPath: optional('DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
  }
}
