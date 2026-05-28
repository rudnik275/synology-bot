import { describe, it, expect } from 'bun:test'
import { createServer, type SubscriptionStore } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import type { Task } from '../../../src/infra/synology/types.ts'
import type { TolokaResult } from '../../../src/infra/toloka/types.ts'
import type { Subscription } from '../../../src/domain/subscription.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeSynology(overrides: Partial<SynologyClient> = {}): SynologyClient {
  const base = {
    listTasks: async () => ({ ok: true as const, data: [] as Task[] }),
    pauseTask: async () => ({ ok: true as const }),
    resumeTask: async () => ({ ok: true as const }),
    deleteTask: async () => ({ ok: true as const }),
    createDownloadTask: async () => ({ ok: true as const }),
    createDownloadTaskFromFile: async () => ({ ok: true as const }),
    listSharedFolders: async () => ({ ok: true as const, data: [] }),
    listFolders: async () => ({ ok: true as const, data: [] }),
    getSystemUtilization: async () => ({ ok: true as const, data: { cpu: { user_load: 1, system_load: 2 }, memory: { real_usage: 30, total_real: 1000, avail_real: 700 } } }),
    getStorageInfo: async () => ({ ok: true as const, data: { volumes: [] } }),
    getDiskInfo: async () => ({ ok: true as const, data: { disks: [] } }),
    getProcessGroups: async () => ({ ok: true as const, data: [] }),
  }
  return { ...base, ...overrides } as unknown as SynologyClient
}

function makeToloka(overrides: Partial<TolokaClient> = {}): TolokaClient {
  const base = {
    search: async () => [] as TolokaResult[],
    downloadTorrent: async () => new Uint8Array([1, 2, 3]),
    getDownloadUrl: (id: string) => `https://toloka.to/download.php?id=${id}`,
  }
  return { ...base, ...overrides } as unknown as TolokaClient
}

function makeStore(overrides: Partial<SubscriptionStore> = {}): SubscriptionStore {
  return {
    listSubscriptions: () => [],
    getSubscription: () => undefined,
    addSubscription: () => {},
    removeSubscription: () => {},
    ...overrides,
  }
}

function makeDocker(overrides: Partial<DockerClient> = {}): DockerClient {
  const base = {
    getContainerByName: async () => ({ id: 'c1', state: 'running', status: 'Up 5 minutes', imageId: 'sha' }),
    getContainerLogs: async () => '',
  }
  return { ...base, ...overrides } as unknown as DockerClient
}

interface AppExtras {
  store?: SubscriptionStore
  docker?: DockerClient
  getShowById?: (showId: number) => Promise<{ title: string }>
}

function makeApp(
  synology: SynologyClient = makeSynology(),
  toloka: TolokaClient = makeToloka(),
  extra: AppExtras = {}
) {
  return createServer({
    synology,
    toloka,
    docker: extra.docker ?? makeDocker(),
    store: extra.store ?? makeStore(),
    getShowById: extra.getShowById ?? (async () => ({ title: 'Default Show' })),
    botToken: TEST_BOT_TOKEN,
    ownerId: OWNER_ID,
    initDataMaxAgeSeconds: 0,
  })
}

function ownerHeaders() {
  return { Authorization: `tma ${buildInitData({ id: OWNER_ID })}` }
}

function jsonReq(body: unknown) {
  return {
    method: 'POST',
    headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('Mini App server — health & liveness', () => {
  it('GET /healthz is open and returns ok', async () => {
    const res = await makeApp().request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/health aggregates sections and reports per-section errors', async () => {
    const app = makeApp(makeSynology({ getDiskInfo: async () => ({ ok: false, reason: 'disk api down' }) }))
    const res = await app.request('/api/health', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.disks).toBeNull()
    expect(body.utilization).not.toBeNull()
    expect(body.errors).toEqual([{ section: 'disks', reason: 'disk api down' }])
  })
})

describe('Mini App server — auth gate', () => {
  it('GET /api/tasks requires auth', async () => {
    const res = await makeApp().request('/api/tasks')
    expect(res.status).toBe(401)
  })

  it('POST /api/tasks/magnet requires auth', async () => {
    const res = await makeApp().request('/api/tasks/magnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet: 'magnet:?xt=1', destination: '/v1' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Mini App server — tasks: read & actions', () => {
  it('GET /api/tasks returns the task list for the owner', async () => {
    const tasks: Task[] = [{ id: 't1', title: 'Movie', status: 'downloading', size: 100 }]
    const app = makeApp(makeSynology({ listTasks: async () => ({ ok: true, data: tasks }) }))
    const res = await app.request('/api/tasks', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tasks })
  })

  it('GET /api/tasks returns 502 when Synology fails', async () => {
    const app = makeApp(makeSynology({ listTasks: async () => ({ ok: false, reason: 'offline' }) }))
    const res = await app.request('/api/tasks', { headers: ownerHeaders() })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'offline' })
  })

  it('POST /api/tasks/:id/pause pauses the task', async () => {
    let pausedId: string | undefined
    const app = makeApp(makeSynology({ pauseTask: async (id) => { pausedId = id; return { ok: true } } }))
    const res = await app.request('/api/tasks/t9/pause', { method: 'POST', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(pausedId).toBe('t9')
  })

  it('POST /api/tasks/:id/resume resumes the task', async () => {
    let resumedId: string | undefined
    const app = makeApp(makeSynology({ resumeTask: async (id) => { resumedId = id; return { ok: true } } }))
    const res = await app.request('/api/tasks/t9/resume', { method: 'POST', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(resumedId).toBe('t9')
  })

  it('POST /api/tasks/:id/pause returns 502 on failure', async () => {
    const app = makeApp(makeSynology({ pauseTask: async () => ({ ok: false, reason: 'no such task' }) }))
    const res = await app.request('/api/tasks/x/pause', { method: 'POST', headers: ownerHeaders() })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'no such task' })
  })

  it('DELETE /api/tasks/:id?deleteFiles=true forwards the flag', async () => {
    let args: { id: string; deleteFiles?: boolean } | undefined
    const app = makeApp(makeSynology({ deleteTask: async (id, deleteFiles) => { args = { id, deleteFiles }; return { ok: true } } }))
    const res = await app.request('/api/tasks/t3?deleteFiles=true', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(args).toEqual({ id: 't3', deleteFiles: true })
  })

  it('DELETE /api/tasks/:id defaults deleteFiles to false', async () => {
    let args: { id: string; deleteFiles?: boolean } | undefined
    const app = makeApp(makeSynology({ deleteTask: async (id, deleteFiles) => { args = { id, deleteFiles }; return { ok: true } } }))
    const res = await app.request('/api/tasks/t3', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(args).toEqual({ id: 't3', deleteFiles: false })
  })
})

describe('Mini App server — tasks: create', () => {
  it('POST /api/tasks/magnet creates a download task', async () => {
    let args: { magnet: string; dest: string } | undefined
    const app = makeApp(makeSynology({ createDownloadTask: async (magnet, dest) => { args = { magnet, dest }; return { ok: true } } }))
    const res = await app.request('/api/tasks/magnet', jsonReq({ magnet: 'magnet:?xt=urn:btih:abc', destination: '/volume1/dl' }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ magnet: 'magnet:?xt=urn:btih:abc', dest: '/volume1/dl' })
  })

  it('POST /api/tasks/magnet 400 when fields missing', async () => {
    const res = await makeApp().request('/api/tasks/magnet', jsonReq({ magnet: 'magnet:?xt=1' }))
    expect(res.status).toBe(400)
  })

  it('POST /api/tasks/toloka downloads then creates from the .torrent', async () => {
    let fileArgs: { name: string; dest: string; len: number } | undefined
    let downloadedUrl: string | undefined
    const synology = makeSynology({
      createDownloadTaskFromFile: async (bytes, name, dest) => { fileArgs = { name, dest, len: bytes.length }; return { ok: true } },
    })
    const toloka = makeToloka({ downloadTorrent: async (url) => { downloadedUrl = url; return new Uint8Array([7, 7]) } })
    const res = await makeApp(synology, toloka).request(
      '/api/tasks/toloka',
      jsonReq({ downloadUrl: 'https://toloka.to/download.php?id=5', title: 'The Matrix', destination: '/volume1/films' })
    )
    expect(res.status).toBe(201)
    expect(downloadedUrl).toBe('https://toloka.to/download.php?id=5')
    expect(fileArgs).toEqual({ name: 'The Matrix.torrent', dest: '/volume1/films', len: 2 })
  })

  it('POST /api/tasks/toloka 502 when the download throws', async () => {
    const toloka = makeToloka({ downloadTorrent: async () => { throw new Error('403 forbidden') } })
    const res = await makeApp(makeSynology(), toloka).request(
      '/api/tasks/toloka',
      jsonReq({ downloadUrl: 'https://toloka.to/download.php?id=5', destination: '/v1' })
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: '403 forbidden' })
  })

  it('POST /api/tasks/file accepts a multipart .torrent upload', async () => {
    let fileArgs: { name: string; dest: string; len: number } | undefined
    const app = makeApp(makeSynology({
      createDownloadTaskFromFile: async (bytes, name, dest) => { fileArgs = { name, dest, len: bytes.length }; return { ok: true } },
    }))
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/x-bittorrent' }), 'movie.torrent')
    const res = await app.request('/api/tasks/file', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(201)
    expect(fileArgs).toEqual({ name: 'movie.torrent', dest: '/volume1/dl', len: 4 })
  })

  it('POST /api/tasks/file 400 without a file', async () => {
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    const res = await makeApp().request('/api/tasks/file', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(400)
  })
})

describe('Mini App server — folders & search', () => {
  it('GET /api/folders lists shared folders at root', async () => {
    const shares = [{ name: 'video', path: '/video' }]
    const app = makeApp(makeSynology({ listSharedFolders: async () => ({ ok: true, data: shares }) }))
    const res = await app.request('/api/folders', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ folders: shares })
  })

  it('GET /api/folders?path=… lists subfolders', async () => {
    let listed: string | undefined
    const app = makeApp(makeSynology({ listFolders: async (p) => { listed = p; return { ok: true, data: [] } } }))
    const res = await app.request('/api/folders?path=%2Fvolume1', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(listed).toBe('/volume1')
  })

  it('GET /api/search returns Toloka results', async () => {
    const results: TolokaResult[] = [
      { id: '5', title: 'The Matrix', downloadUrl: 'https://toloka.to/download.php?id=5', size: '4.7 GB', seeders: 10, leechers: 1, category: 'Кино' },
    ]
    const app = makeApp(makeSynology(), makeToloka({ search: async () => results }))
    const res = await app.request('/api/search?q=matrix', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results })
  })

  it('GET /api/search 400 without a query', async () => {
    const res = await makeApp().request('/api/search', { headers: ownerHeaders() })
    expect(res.status).toBe(400)
  })

  it('GET /api/search 502 when Toloka throws', async () => {
    const app = makeApp(makeSynology(), makeToloka({ search: async () => { throw new Error('login page') } }))
    const res = await app.request('/api/search?q=matrix', { headers: ownerHeaders() })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'login page' })
  })
})

describe('Mini App server — subscriptions', () => {
  it('GET /api/subscriptions lists subscriptions', async () => {
    const subs: Subscription[] = [{ id: '1', showId: 1, title: 'Show One' }]
    const app = makeApp(makeSynology(), makeToloka(), { store: makeStore({ listSubscriptions: () => subs }) })
    const res = await app.request('/api/subscriptions', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subscriptions: subs })
  })

  it('POST /api/subscriptions resolves the title and stores it', async () => {
    let added: Subscription | undefined
    const store = makeStore({ addSubscription: (s) => { added = s } })
    const app = makeApp(makeSynology(), makeToloka(), { store, getShowById: async () => ({ title: 'The Expanse' }) })
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId: 7 }),
    })
    expect(res.status).toBe(201)
    expect(added).toEqual({ id: '7', showId: 7, title: 'The Expanse' })
    expect(await res.json()).toEqual({ subscription: { id: '7', showId: 7, title: 'The Expanse' } })
  })

  it('POST /api/subscriptions is idempotent when already subscribed', async () => {
    const existing: Subscription = { id: '7', showId: 7, title: 'Already' }
    let addCalled = false
    const store = makeStore({ getSubscription: () => existing, addSubscription: () => { addCalled = true } })
    const app = makeApp(makeSynology(), makeToloka(), { store })
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId: 7 }),
    })
    expect(res.status).toBe(200)
    expect(addCalled).toBe(false)
    expect(await res.json()).toEqual({ subscription: existing })
  })

  it('POST /api/subscriptions 400 on a non-integer showId', async () => {
    const res = await makeApp().request('/api/subscriptions', {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId: 'nope' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/subscriptions 502 when the show lookup fails', async () => {
    const app = makeApp(makeSynology(), makeToloka(), { getShowById: async () => { throw new Error('myshows down') } })
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId: 7 }),
    })
    expect(res.status).toBe(502)
  })

  it('DELETE /api/subscriptions/:id removes an existing subscription', async () => {
    let removedId: string | undefined
    const store = makeStore({
      getSubscription: () => ({ id: '7', showId: 7, title: 'X' }),
      removeSubscription: (id) => { removedId = id },
    })
    const app = makeApp(makeSynology(), makeToloka(), { store })
    const res = await app.request('/api/subscriptions/7', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(removedId).toBe('7')
  })

  it('DELETE /api/subscriptions/:id 404 when not found', async () => {
    const res = await makeApp().request('/api/subscriptions/99', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(404)
  })
})

describe('Mini App server — deploy status', () => {
  it('reports running with the last check time', async () => {
    const docker = makeDocker({
      getContainerByName: async () => ({ id: 'c1', state: 'running', status: 'Up 2 hours', imageId: 'sha' }),
      getContainerLogs: async () => '2026-05-28T10:05:00Z time="..." level=info msg="Session done"',
    })
    const res = await makeApp(makeSynology(), makeToloka(), { docker }).request('/api/deploy-status', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state).toBe('running')
    expect(body.status).toBe('Up 2 hours')
    expect(body.lastCheck).toBe('2026-05-28T10:05:00.000Z')
  })

  it('reports not_found when the container is missing', async () => {
    const docker = makeDocker({ getContainerByName: async () => null })
    const res = await makeApp(makeSynology(), makeToloka(), { docker }).request('/api/deploy-status', { headers: ownerHeaders() })
    expect(await res.json()).toEqual({ state: 'not_found' })
  })

  it('reports stopped when the container is not running', async () => {
    const docker = makeDocker({ getContainerByName: async () => ({ id: 'c1', state: 'exited', status: 'Exited (0)', imageId: 'sha' }) })
    const res = await makeApp(makeSynology(), makeToloka(), { docker }).request('/api/deploy-status', { headers: ownerHeaders() })
    expect(await res.json()).toEqual({ state: 'stopped', status: 'Exited (0)' })
  })

  it('502 when the Docker socket errors', async () => {
    const docker = makeDocker({ getContainerByName: async () => { throw new Error('ECONNREFUSED') } })
    const res = await makeApp(makeSynology(), makeToloka(), { docker }).request('/api/deploy-status', { headers: ownerHeaders() })
    expect(res.status).toBe(502)
  })
})
