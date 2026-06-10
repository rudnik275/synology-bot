// Endpoint tests for Mini App runtime settings (#305):
//   GET /api/settings → { settings }
//   PUT /api/settings { partial } → { settings } | 400 { error, fields }
// Owner-gated by the /api/* middleware like every other API route.
import { describe, it, expect } from 'bun:test'
import { createServer } from '../../../src/server/server.ts'
import { createSettingsProvider, type AppSettings } from '../../../src/domain/settings.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import type { MyShowsShowDetailed } from '../../../src/infra/myshows/client.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

const DEFAULTS: AppSettings = {
  diskUsageHighPct: 90,
  diskUsageLowPct: 85,
  diskTempWarnC: 50,
  diskTempBadC: 56,
  digestHour: 9,
  autoCleanerRetentionDays: 7,
}

function makeSettings() {
  const map = new Map<string, string>()
  return createSettingsProvider(
    { getKv: (k) => map.get(k), setKv: (k, v) => { map.set(k, v) } },
    DEFAULTS,
  )
}

function makeApp(settings: ReturnType<typeof makeSettings> | null = makeSettings()) {
  return createServer({
    ...(settings ? { settings } : {}),
    clearNotifFired: () => {},
    synology: {} as unknown as SynologyClient,
    toloka: {} as unknown as TolokaClient,
    docker: {} as unknown as DockerClient,
    store: { listSubscriptions: () => [], getSubscription: () => undefined, addSubscription: () => {}, removeSubscription: () => {} },
    getShowById: async () => ({ id: 1, title: 'X', episodes: [] }) as MyShowsShowDetailed,
    getTodayEpisodes: async () => [],
    searchShows: async () => [],
    tolokaBaseUrl: 'https://toloka.to',
    miniappUrl: 'https://nas.test',
    botToken: TEST_BOT_TOKEN,
    ownerId: OWNER_ID,
    initDataMaxAgeSeconds: 0,
  })
}

function ownerHeaders() {
  return { Authorization: `tma ${buildInitData({ id: OWNER_ID })}` }
}

describe('GET/PUT /api/settings', () => {
  it('requires auth', async () => {
    const res = await makeApp().request('/api/settings')
    expect(res.status).toBe(401)
  })

  it('GET returns the effective settings (defaults when nothing stored)', async () => {
    const res = await makeApp().request('/api/settings', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ settings: DEFAULTS })
  })

  it('PUT persists valid values and GET reads them back (round-trip)', async () => {
    const app = makeApp()
    const put = await app.request('/api/settings', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ diskUsageHighPct: 95, diskUsageLowPct: 80, digestHour: 18 }),
    })
    expect(put.status).toBe(200)
    const putBody = await put.json() as { settings: AppSettings }
    expect(putBody.settings.diskUsageHighPct).toBe(95)

    const get = await app.request('/api/settings', { headers: ownerHeaders() })
    const getBody = await get.json() as { settings: AppSettings }
    expect(getBody.settings).toEqual({ ...DEFAULTS, diskUsageHighPct: 95, diskUsageLowPct: 80, digestHour: 18 })
  })

  it('PUT with out-of-range values → 400 with per-field errors', async () => {
    const res = await makeApp().request('/api/settings', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ digestHour: 24 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; fields: Record<string, string> }
    expect(body.error).toBe('invalid settings')
    expect(body.fields.digestHour).toBeDefined()
  })

  it('PUT violating low < high → 400, nothing persisted', async () => {
    const app = makeApp()
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ diskUsageLowPct: 95 }),
    })
    expect(res.status).toBe(400)
    const get = await app.request('/api/settings', { headers: ownerHeaders() })
    expect(await get.json()).toEqual({ settings: DEFAULTS })
  })

  it('PUT with a non-object body → 400', async () => {
    const res = await makeApp().request('/api/settings', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2]),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the provider is not wired', async () => {
    const app = makeApp(null)
    const res = await app.request('/api/settings', { headers: ownerHeaders() })
    expect(res.status).toBe(404)
  })
})
