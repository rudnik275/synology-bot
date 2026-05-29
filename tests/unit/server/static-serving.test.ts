import { describe, it, expect } from 'bun:test'
import { createServer } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'

// The static routes and /healthz never touch the injected clients, so empty
// stubs are enough. staticRoot points at a committed fixture SPA build so the
// test doesn't depend on a real `vite build`.
function makeApp() {
  return createServer({
    synology: {} as unknown as SynologyClient,
    toloka: {} as unknown as TolokaClient,
    docker: {} as unknown as DockerClient,
    store: { listSubscriptions: () => [], getSubscription: () => undefined, addSubscription: () => {}, removeSubscription: () => {} },
    getShowById: async () => ({ title: '' }),
    getTodayEpisodes: async () => [],
    tolokaBaseUrl: 'https://toloka.to',
    botToken: 'test-token',
    ownerId: 42,
    initDataMaxAgeSeconds: 0,
    staticRoot: 'tests/fixtures/spa-dist',
  })
}

describe('Mini App server — static SPA serving', () => {
  it('serves index.html at the root', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('SPA_FIXTURE_MARKER')
  })

  it('falls back to index.html for unknown client-side routes', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/shows/123/deep'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('SPA_FIXTURE_MARKER')
  })

  it('serves built assets from /assets/*', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/assets/app.js'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('SPA_FIXTURE_ASSET')
  })

  it('keeps /healthz priority over the SPA fallback', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/healthz'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('keeps /api/* priority over the SPA fallback (401 without auth, not index.html)', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html')
  })
})
