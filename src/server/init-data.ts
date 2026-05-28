import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: string }

export interface VerifyOptions {
  /** Reject initData older than this many seconds. 0 disables the check. Default 86400 (24h). */
  maxAgeSeconds?: number
  /** Injectable clock for tests (ms since epoch). */
  now?: () => number
}

/**
 * Verify a Telegram Mini App `initData` string.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Checks the HMAC signature against the bot token, the auth_date freshness,
 * and parses the embedded user. Does NOT check owner identity — that's the
 * caller's job (compare the returned user.id to OWNER_CHAT_ID).
 */
export function verifyInitData(
  initDataRaw: string,
  botToken: string,
  opts: VerifyOptions = {}
): InitDataResult {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 86_400
  const now = opts.now ?? Date.now

  const params = new URLSearchParams(initDataRaw)

  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'missing hash' }

  const pairs: string[] = []
  for (const [key, value] of params) {
    if (key === 'hash') continue
    pairs.push(`${key}=${value}`)
  }
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const secretKey = new Uint8Array(createHmac('sha256', 'WebAppData').update(botToken).digest())
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (!timingSafeEqualHex(computed, hash)) {
    return { ok: false, reason: 'bad signature' }
  }

  const authDateRaw = params.get('auth_date')
  const authDate = Number(authDateRaw)
  if (!authDateRaw || !Number.isFinite(authDate)) {
    return { ok: false, reason: 'missing or invalid auth_date' }
  }
  if (maxAgeSeconds > 0 && now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'initData expired' }
  }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, reason: 'missing user' }
  let user: TelegramUser
  try {
    user = JSON.parse(userRaw) as TelegramUser
  } catch {
    return { ok: false, reason: 'malformed user' }
  }
  if (typeof user.id !== 'number') {
    return { ok: false, reason: 'user has no id' }
  }

  return { ok: true, user, authDate }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length === 0 || bufA.length !== bufB.length) return false
  return timingSafeEqual(new Uint8Array(bufA), new Uint8Array(bufB))
}
