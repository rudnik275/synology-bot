/**
 * Settings routes (#305): GET/PUT /api/settings for runtime-tunable watcher
 * thresholds + digest hour. Owner-gated by the /api/* middleware like every
 * other API route. Validation/clamping lives in the domain provider
 * (src/domain/settings.ts); these routes are a thin JSON shell over it.
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { SettingsProvider } from '../../domain/settings.ts'

export interface SettingsRouteDeps {
  settings?: SettingsProvider
}

export function registerSettingsRoutes(app: Hono<AppEnv>, deps: SettingsRouteDeps): void {
  app.get('/api/settings', (c) => {
    if (!deps.settings) return c.json({ error: 'settings unavailable' }, 404)
    return c.json({ settings: deps.settings.get() })
  })

  app.put('/api/settings', async (c) => {
    if (!deps.settings) return c.json({ error: 'settings unavailable' }, 404)
    const body = await c.req.json().catch(() => null)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'body must be a JSON object' }, 400)
    }
    const result = deps.settings.update(body as Record<string, unknown>)
    if (!result.ok) {
      return c.json({ error: 'invalid settings', fields: result.errors }, 400)
    }
    return c.json({ settings: result.settings })
  })
}
