// Endpoint tests for Mini App UI state (#4):
//   GET /api/ui-state/:key  → { values }
//   PUT /api/ui-state/:key  { values } → { ok }
// Persisted server-side because Telegram WebView localStorage is wiped between
// sessions/redeploys. Whitelisted keys only.
import { describe, it, expect } from 'bun:test'
import { createServer, type UiStateStore } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import type { MyShowsShowDetailed } from '../../../src/infra/myshows/client.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeUiState(): UiStateStore {
  const m = new Map<string, string[]>()
  return {
    getUiList: (key) => m.get(key) ?? [],
    setUiList: (key, values) => { m.set(key, values) },
  }
}

function makeApp(uiState: UiStateStore = makeUiState()) {
  return createServer({
    synology: {} as unknown as SynologyClient,
    toloka: {} as unknown as TolokaClient,
    docker: {} as unknown as DockerClient,
    store: { listSubscriptions: () => [], getSubscription: () => undefined, addSubscription: () => {}, removeSubscription: () => {} },
    getShowById: async () => ({ id: 1, title: 'X', episodes: [] }) as MyShowsShowDetailed,
    getTodayEpisodes: async () => [],
    searchShows: async () => [],
    clearNotifFired: () => {},
    tolokaBaseUrl: 'https://toloka.to',
    miniappUrl: 'https://nas.test',
    botToken: TEST_BOT_TOKEN,
    ownerId: OWNER_ID,
    initDataMaxAgeSeconds: 0,
    uiState,
  })
}

function ownerHeaders() {
  return { Authorization: `tma ${buildInitData({ id: OWNER_ID })}` }
}

describe('GET/PUT /api/ui-state/:key', () => {
  it('requires auth', async () => {
    const res = await makeApp().request('/api/ui-state/search-history')
    expect(res.status).toBe(401)
  })

  it('returns an empty list for a fresh key', async () => {
    const res = await makeApp().request('/api/ui-state/search-history', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ values: [] })
  })

  it('persists and reads back values (round-trip)', async () => {
    const app = makeApp()
    const put = await app.request('/api/ui-state/search-history', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: ['from', 'severance'] }),
    })
    expect(put.status).toBe(200)
    const get = await app.request('/api/ui-state/search-history', { headers: ownerHeaders() })
    expect(await get.json()).toEqual({ values: ['from', 'severance'] })
  })

  it('persists and reads back folder favorites (#306)', async () => {
    const app = makeApp()
    const put = await app.request('/api/ui-state/folder-favorites', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: ['/video/сериалы'] }),
    })
    expect(put.status).toBe(200)
    const get = await app.request('/api/ui-state/folder-favorites', { headers: ownerHeaders() })
    expect(await get.json()).toEqual({ values: ['/video/сериалы'] })
  })

  it('rejects unknown keys with 404', async () => {
    const res = await makeApp().request('/api/ui-state/evil-key', { headers: ownerHeaders() })
    expect(res.status).toBe(404)
  })

  it('rejects a non-string-array body with 400', async () => {
    const res = await makeApp().request('/api/ui-state/search-history', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [1, 2, 3] }),
    })
    expect(res.status).toBe(400)
  })

  it('caps stored values at 50', async () => {
    let stored: string[] = []
    const app = makeApp({ getUiList: () => stored, setUiList: (_k, v) => { stored = v } })
    const big = Array.from({ length: 80 }, (_, i) => `q${i}`)
    await app.request('/api/ui-state/folder-recents', {
      method: 'PUT',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: big }),
    })
    expect(stored.length).toBe(50)
  })
})
