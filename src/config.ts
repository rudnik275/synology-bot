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
  }
  dbPath: string
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
    },
    dbPath: optional('DB_PATH', './data/bot.db'),
  }
}
