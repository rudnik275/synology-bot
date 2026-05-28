import { createMiddleware } from 'hono/factory'
import { verifyInitData, type TelegramUser } from './init-data.ts'

/** Hono environment shared by every authenticated route. */
export interface AppEnv {
  Variables: { user: TelegramUser }
}

export interface OwnerAuthConfig {
  botToken: string
  ownerId: number
  maxAgeSeconds?: number
}

/**
 * Gate every request behind a valid Telegram Mini App `initData` that belongs
 * to the Owner. The client sends it as `Authorization: tma <initData>` (the
 * @telegram-apps convention). Anyone without valid, owner-signed initData —
 * even knowing the URL — gets 401; there is no login (see ADR 0005).
 */
export function ownerAuth(config: OwnerAuthConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const raw = header.startsWith('tma ') ? header.slice(4) : ''
    if (!raw) return c.json({ error: 'unauthorized' }, 401)

    const result = verifyInitData(raw, config.botToken, { maxAgeSeconds: config.maxAgeSeconds })
    if (!result.ok || result.user.id !== config.ownerId) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    c.set('user', result.user)
    await next()
  })
}
