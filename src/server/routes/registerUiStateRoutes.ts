/**
 * UI state routes: server-side persistence for Mini App UI lists (#4).
 * Search history and folder recents persisted server-side because Telegram
 * WebView localStorage is wiped between sessions/redeploys (esp. iOS).
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { UiStateStore } from '../server.ts'

export interface UiStateRouteDeps {
  uiState?: UiStateStore
}

const UI_STATE_KEYS = new Set(['search-history', 'folder-recents'])
const UI_STATE_CAP = 50

export function registerUiStateRoutes(app: Hono<AppEnv>, deps: UiStateRouteDeps): void {
  app.get('/api/ui-state/:key', (c) => {
    const key = c.req.param('key')
    if (!UI_STATE_KEYS.has(key)) return c.json({ error: 'unknown ui-state key' }, 404)
    return c.json({ values: deps.uiState?.getUiList(key) ?? [] })
  })

  app.put('/api/ui-state/:key', async (c) => {
    const key = c.req.param('key')
    if (!UI_STATE_KEYS.has(key)) return c.json({ error: 'unknown ui-state key' }, 404)
    const body = await c.req.json().catch(() => null)
    const values = (body as Record<string, unknown> | null)?.values
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      return c.json({ error: 'values must be an array of strings' }, 400)
    }
    deps.uiState?.setUiList(key, values.slice(0, UI_STATE_CAP))
    return c.json({ ok: true })
  })
}
