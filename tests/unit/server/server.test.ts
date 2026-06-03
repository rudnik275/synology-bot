import { describe, it, expect } from 'bun:test'
import { createServer, type SubscriptionStore, type TodayEpisode } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import type { Task } from '../../../src/infra/synology/types.ts'
import type { TolokaResult } from '../../../src/infra/toloka/types.ts'
import type { Subscription } from '../../../src/domain/subscription.ts'
import type { MyShowsShowDetailed, MyShowsSearchResult } from '../../../src/infra/myshows/client.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeSynology(overrides: Partial<SynologyClient> = {}): SynologyClient {
  const base = {
    listTasks: async () => ({ ok: true as const, data: [] as Task[] }),
    pauseTask: async () => ({ ok: true as const }),
    resumeTask: async () => ({ ok: true as const }),
    deleteTask: async () => ({ ok: true as const }),
    createDownloadTask: async () => ({ ok: true as const }),
    createInspectList: async () => ({ ok: true as const, listId: 'btdl_test' }),
    getInspectList: async () => ({ ok: true as const, data: { files: [{ index: 0, name: 'Movie/a.mkv', size: 100 }], title: 'Movie', size: 100, type: 'bt' } }),
    commitInspectList: async () => ({ ok: true as const }),
    deleteInspectList: async () => ({ ok: true as const }),
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

function makeDefaultShow(overrides: Partial<MyShowsShowDetailed> = {}): MyShowsShowDetailed {
  return {
    id: 1,
    title: 'Default Show',
    episodes: [],
    ...overrides,
  }
}

interface AppExtras {
  store?: SubscriptionStore
  docker?: DockerClient
  getShowById?: (showId: number) => Promise<MyShowsShowDetailed>
  getTodayEpisodes?: (showId: number) => Promise<TodayEpisode[]>
  searchShows?: (query: string) => Promise<MyShowsSearchResult[]>
  tolokaBaseUrl?: string
  miniappUrl?: string
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
    getShowById: extra.getShowById ?? (async () => makeDefaultShow()),
    getTodayEpisodes: extra.getTodayEpisodes ?? (async () => []),
    searchShows: extra.searchShows ?? (async () => []),
    tolokaBaseUrl: extra.tolokaBaseUrl ?? 'https://toloka.to',
    miniappUrl: extra.miniappUrl ?? 'https://nas.test',
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

  it('GET /api/health returns the normalized contract shape', async () => {
    const res = await makeApp().request('/api/health', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cpu).toEqual({ userLoad: 1, systemLoad: 2 })
    expect(body.memory).toEqual({ usedBytes: 307200, totalBytes: 1024000, pct: 30 })
    expect(body.volumes).toEqual([])
    expect(body.disks).toEqual([])
    expect(body.processes).toEqual({ topRam: [], topCpu: [] })
    expect(body.errors).toEqual([])
  })

  it('GET /api/health nulls a failed section and reports it in errors', async () => {
    const app = makeApp(makeSynology({ getDiskInfo: async () => ({ ok: false, reason: 'disk api down' }) }))
    const res = await app.request('/api/health', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.disks).toBeNull()
    expect(body.cpu).not.toBeNull()
    expect(body.errors).toEqual([{ section: 'disks', reason: 'disk api down' }])
  })
})

describe('Mini App server — auth gate', () => {
  it('GET /api/tasks requires auth', async () => {
    const res = await makeApp().request('/api/tasks')
    expect(res.status).toBe(401)
  })

  it('POST /api/tasks requires auth', async () => {
    const res = await makeApp().request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'magnet:?xt=1', destination: '/v1' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Mini App server — tasks: read & actions', () => {
  it('GET /api/tasks returns the contract shape (pct/speed/downloaded derived)', async () => {
    const tasks: Task[] = [
      {
        id: 't1',
        title: 'Movie',
        status: 'downloading',
        size: 200,
        additional: { detail: { destination: '/volume1/films' }, transfer: { size_downloaded: 50, speed_download: 10 } },
      },
    ]
    const app = makeApp(makeSynology({ listTasks: async () => ({ ok: true, data: tasks }) }))
    const res = await app.request('/api/tasks', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      tasks: [
        {
          id: 't1',
          title: 'Movie',
          status: 'downloading',
          sizeBytes: 200,
          downloadedBytes: 50,
          speedBytesPerSec: 10,
          pct: 25,
          destination: '/volume1/films',
        },
      ],
    })
  })

  it('GET /api/tasks tolerates a task with no transfer block', async () => {
    const tasks: Task[] = [{ id: 't1', title: 'Movie', status: 'waiting', size: 100 }]
    const app = makeApp(makeSynology({ listTasks: async () => ({ ok: true, data: tasks }) }))
    const res = await app.request('/api/tasks', { headers: ownerHeaders() })
    const body = await res.json()
    expect(body.tasks[0]).toEqual({
      id: 't1',
      title: 'Movie',
      status: 'waiting',
      sizeBytes: 100,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      pct: 0,
      destination: null,
    })
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

describe('Mini App server — tasks: create (unified POST /api/tasks)', () => {
  it('creates from a magnet uri', async () => {
    let args: { uri: string; dest: string } | undefined
    const app = makeApp(makeSynology({ createDownloadTask: async (uri, dest) => { args = { uri, dest }; return { ok: true } } }))
    const res = await app.request('/api/tasks', jsonReq({ uri: 'magnet:?xt=urn:btih:abc', destination: '/volume1/dl' }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ uri: 'magnet:?xt=urn:btih:abc', dest: '/volume1/dl' })
  })

  it('hands a plain (non-Toloka) URL straight to DownloadStation', async () => {
    let args: { uri: string; dest: string } | undefined
    const app = makeApp(makeSynology({ createDownloadTask: async (uri, dest) => { args = { uri, dest }; return { ok: true } } }))
    const res = await app.request('/api/tasks', jsonReq({ uri: 'https://example.com/x.torrent', destination: '/v1' }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ uri: 'https://example.com/x.torrent', dest: '/v1' })
  })

  it('fetches a Toloka URL with auth, then serves the .torrent for DownloadStation to fetch by URL', async () => {
    let createArgs: { uri: string; dest: string } | undefined
    let downloadedUrl: string | undefined
    const synology = makeSynology({
      createDownloadTask: async (uri, dest) => { createArgs = { uri, dest }; return { ok: true } },
    })
    const toloka = makeToloka({ downloadTorrent: async (url) => { downloadedUrl = url; return new Uint8Array([7, 7]) } })
    const app = makeApp(synology, toloka)
    const res = await app.request(
      '/api/tasks',
      jsonReq({ uri: 'https://toloka.to/download.php?id=5', title: 'The Matrix', destination: '/volume1/films' })
    )
    expect(res.status).toBe(201)
    expect(downloadedUrl).toBe('https://toloka.to/download.php?id=5')
    // DSM is handed a self-hosted .torrent URL it fetches itself (no Telegram, no multipart).
    expect(createArgs?.dest).toBe('/volume1/films')
    expect(createArgs?.uri).toMatch(/^https:\/\/nas\.test\/torrent-file\/[a-f0-9]+\.torrent$/)
    // …and that URL actually serves the fetched bytes back (open route, no auth — DSM can't sign initData).
    const served = await app.request(new URL(createArgs!.uri).pathname)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('application/x-bittorrent')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([7, 7]))
  })

  it('502 when the Toloka download throws', async () => {
    const toloka = makeToloka({ downloadTorrent: async () => { throw new Error('403 forbidden') } })
    const res = await makeApp(makeSynology(), toloka).request(
      '/api/tasks',
      jsonReq({ uri: 'https://toloka.to/download.php?id=5', destination: '/v1' })
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: '403 forbidden' })
  })

  it('400 when uri or destination is missing', async () => {
    const res = await makeApp().request('/api/tasks', jsonReq({ uri: 'magnet:?xt=1' }))
    expect(res.status).toBe(400)
  })

  it('accepts a multipart .torrent upload — serves it for DownloadStation to fetch by URL', async () => {
    let createArgs: { uri: string; dest: string } | undefined
    const app = makeApp(makeSynology({
      createDownloadTask: async (uri, dest) => { createArgs = { uri, dest }; return { ok: true } },
    }))
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/x-bittorrent' }), 'movie.torrent')
    const res = await app.request('/api/tasks', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(201)
    expect(createArgs?.dest).toBe('/volume1/dl')
    expect(createArgs?.uri).toMatch(/^https:\/\/nas\.test\/torrent-file\/[a-f0-9]+\.torrent$/)
    const served = await app.request(new URL(createArgs!.uri).pathname)
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('400 on a multipart upload without a file', async () => {
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    const res = await makeApp().request('/api/tasks', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(400)
  })
})

describe('Mini App server — per-file selection (inspect → commit)', () => {
  it('POST /api/tasks/inspect requires auth', async () => {
    const res = await makeApp().request('/api/tasks/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'magnet:?xt=1', destination: '/v1' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/tasks/inspect (magnet) returns the list_id and forwards to createInspectList', async () => {
    let args: { uri: string; dest: string } | undefined
    const app = makeApp(makeSynology({
      createInspectList: async (uri, dest) => { args = { uri, dest }; return { ok: true, listId: 'btdlABC' } },
    }))
    const res = await app.request('/api/tasks/inspect', jsonReq({ uri: 'magnet:?xt=urn:btih:abc', destination: '/v1' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ listId: 'btdlABC' })
    expect(args).toEqual({ uri: 'magnet:?xt=urn:btih:abc', dest: '/v1' })
  })

  it('POST /api/tasks/inspect (Toloka) self-hosts the .torrent, then inspects that URL', async () => {
    let inspectArgs: { uri: string; dest: string } | undefined
    const synology = makeSynology({
      createInspectList: async (uri, dest) => { inspectArgs = { uri, dest }; return { ok: true, listId: 'btdlT' } },
    })
    const toloka = makeToloka({ downloadTorrent: async () => new Uint8Array([9, 9]) })
    const res = await makeApp(synology, toloka).request(
      '/api/tasks/inspect',
      jsonReq({ uri: 'https://toloka.to/download.php?id=5', destination: '/films' })
    )
    expect(res.status).toBe(201)
    expect(inspectArgs?.dest).toBe('/films')
    expect(inspectArgs?.uri).toMatch(/^https:\/\/nas\.test\/torrent-file\/[a-f0-9]+\.torrent$/)
  })

  it('POST /api/tasks/inspect 502 when createInspectList fails', async () => {
    const app = makeApp(makeSynology({ createInspectList: async () => ({ ok: false, reason: 'no list_id' }) }))
    const res = await app.request('/api/tasks/inspect', jsonReq({ uri: 'magnet:?xt=1', destination: '/v1' }))
    expect(res.status).toBe(502)
  })

  it('GET /api/tasks/inspect/:listId returns ready + the file tree', async () => {
    const app = makeApp(makeSynology({
      getInspectList: async (listId) => ({
        ok: true,
        data: { files: [{ index: 0, name: 'S/a.mkv', size: 10 }, { index: 1, name: 'S/b.srt', size: 2 }], title: 'S', size: 12, type: 'bt' },
      }) as any,
    }))
    const res = await app.request('/api/tasks/inspect/btdlABC', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ready: true,
      title: 'S',
      size: 12,
      files: [{ index: 0, name: 'S/a.mkv', size: 10 }, { index: 1, name: 'S/b.srt', size: 2 }],
    })
  })

  it('GET /api/tasks/inspect/:listId reports ready:false while metadata is still fetching', async () => {
    const app = makeApp(makeSynology({
      getInspectList: async () => ({ ok: true, data: { files: [], title: '', size: 0, type: 'bt' } }) as any,
    }))
    const res = await app.request('/api/tasks/inspect/btdlABC', { headers: ownerHeaders() })
    expect((await res.json()).ready).toBe(false)
  })

  it('POST /api/tasks/commit forwards listId, selected indices, and destination', async () => {
    let args: { listId: string; selected: number[]; dest: string } | undefined
    const app = makeApp(makeSynology({
      commitInspectList: async (listId, selected, dest) => { args = { listId, selected, dest }; return { ok: true } },
    }))
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'btdlABC', selected: [0, 5], destination: '/v1' }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ listId: 'btdlABC', selected: [0, 5], dest: '/v1' })
  })

  it('POST /api/tasks/commit 400 when listId or destination missing', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ selected: [0], destination: '/v1' }))
    expect(res.status).toBe(400)
  })

  it('POST /api/tasks/commit 400 when selected is not an integer array', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ listId: 'x', selected: ['a'], destination: '/v1' }))
    expect(res.status).toBe(400)
  })

  it('DELETE /api/tasks/inspect/:listId abandons the inspect', async () => {
    let deleted: string | undefined
    const app = makeApp(makeSynology({ deleteInspectList: async (listId) => { deleted = listId; return { ok: true } } }))
    const res = await app.request('/api/tasks/inspect/btdlABC', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(deleted).toBe('btdlABC')
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

  it('GET /api/search returns the normalized result shape', async () => {
    const results: TolokaResult[] = [
      { id: '5', title: 'The Matrix', downloadUrl: 'https://toloka.to/download.php?id=5', size: '4.7 GB', seeders: 10, leechers: 1, category: 'Кино' },
    ]
    const app = makeApp(makeSynology(), makeToloka({ search: async () => results }))
    const res = await app.request('/api/search?q=matrix', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      results: [
        { id: '5', title: 'The Matrix', size: '4.7 GB', seeders: 10, leechers: 1, downloadUrl: 'https://toloka.to/download.php?id=5', category: 'Кино' },
      ],
    })
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
  it('GET /api/subscriptions lists subscriptions in the contract shape', async () => {
    const subs: Subscription[] = [{ id: '1', showId: 1, title: 'Show One', lastNotifiedEpisode: { season: 2, episode: 3 } }]
    const app = makeApp(makeSynology(), makeToloka(), { store: makeStore({ listSubscriptions: () => subs }) })
    const res = await app.request('/api/subscriptions', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { subscriptions: unknown[] }
    expect(body.subscriptions).toHaveLength(1)
    expect((body.subscriptions[0] as Record<string, unknown>).id).toBe('1')
    expect((body.subscriptions[0] as Record<string, unknown>).title).toBe('Show One')
  })

  it('GET /api/subscriptions/today is retired and returns 404', async () => {
    const res = await makeApp().request('/api/subscriptions/today', { headers: ownerHeaders() })
    expect(res.status).toBe(404)
  })

  it('POST /api/subscriptions resolves the title and stores it', async () => {
    let added: Subscription | undefined
    const store = makeStore({ addSubscription: (s) => { added = s } })
    const app = makeApp(makeSynology(), makeToloka(), {
      store,
      getShowById: async () => makeDefaultShow({ id: 7, title: 'The Expanse' }),
    })
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId: 7 }),
    })
    expect(res.status).toBe(201)
    expect(added?.id).toBe('7')
    expect(added?.showId).toBe(7)
    expect(added?.title).toBe('The Expanse')
    const body = await res.json() as { subscription: { id: string; showId: number; title: string } }
    expect(body.subscription.id).toBe('7')
    expect(body.subscription.title).toBe('The Expanse')
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
    const body = await res.json() as { subscription: { id: string } }
    expect(body.subscription.id).toBe('7')
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
    const app = makeApp(makeSynology(), makeToloka(), { getShowById: async (): Promise<MyShowsShowDetailed> => { throw new Error('myshows down') } })
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

  it('POST /api/subscriptions/refresh backfills poster + latestAiredEpisode for all subs', async () => {
    const subs = [
      { id: '1', showId: 1, title: 'A' },
      { id: '2', showId: 2, title: 'B' },
    ]
    const saved: Array<{ showId: number; poster?: string }> = []
    const store = makeStore({
      listSubscriptions: () => subs,
      addSubscription: (s) => { saved.push(s) },
    })
    const app = makeApp(makeSynology(), makeToloka(), {
      store,
      getShowById: async (showId) =>
        makeDefaultShow({
          id: showId,
          image: `https://img/${showId}.jpg`,
          episodes: [{ id: 1, title: 'Ep', seasonNumber: 1, episodeNumber: 1, airDateUTC: '2020-01-01T00:00:00Z' }],
        }),
    })
    const res = await app.request('/api/subscriptions/refresh', { method: 'POST', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { subscriptions: Array<{ poster: string | null; latestAiredEpisode: { season: number; episode: number } | null }> }
    expect(body.subscriptions).toHaveLength(2)
    expect(body.subscriptions[0].poster).toBe('https://img/1.jpg')
    expect(body.subscriptions[0].latestAiredEpisode).toMatchObject({ season: 1, episode: 1 })
    expect(saved).toHaveLength(2) // both persisted back to the store
  })

  it('POST /api/subscriptions/refresh requires auth', async () => {
    const res = await makeApp().request('/api/subscriptions/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('Mini App server — shows search & detail (ADR 0009)', () => {
  const SEARCH_RESULTS: MyShowsSearchResult[] = [
    { id: 1396, title: 'Во все тяжкие', titleOriginal: 'Breaking Bad', image: 'https://myshows.me/img/1396.jpg' },
    { id: 99, title: 'Some Show' },
  ]

  const DETAIL_SHOW: MyShowsShowDetailed = {
    id: 1396,
    title: 'Во все тяжкие',
    titleOriginal: 'Breaking Bad',
    image: 'https://myshows.me/img/1396.jpg',
    description: 'Chemistry.',
    episodes: [
      { id: 1, title: 'Pilot', seasonNumber: 1, episodeNumber: 1, airDateUTC: '2008-01-20T02:00:00Z' },
    ],
  }

  it('GET /api/shows/search returns results with isSubscribed marker', async () => {
    const subs: Subscription[] = [{ id: '1396', showId: 1396, title: 'Во все тяжкие' }]
    const app = makeApp(makeSynology(), makeToloka(), {
      store: makeStore({ listSubscriptions: () => subs }),
      searchShows: async () => SEARCH_RESULTS,
    })
    const res = await app.request('/api/shows/search?q=Breaking+Bad', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ id: number; isSubscribed: boolean }> }
    expect(body.results).toHaveLength(2)
    expect(body.results[0].id).toBe(1396)
    expect(body.results[0].isSubscribed).toBe(true)
    expect(body.results[1].isSubscribed).toBe(false)
  })

  it('GET /api/shows/search 400 without a query', async () => {
    const res = await makeApp().request('/api/shows/search', { headers: ownerHeaders() })
    expect(res.status).toBe(400)
  })

  it('GET /api/shows/search 502 when myshows throws', async () => {
    const app = makeApp(makeSynology(), makeToloka(), { searchShows: async () => { throw new Error('rpc error') } })
    const res = await app.request('/api/shows/search?q=test', { headers: ownerHeaders() })
    expect(res.status).toBe(502)
  })

  it('GET /api/shows/:id returns the detail view', async () => {
    const app = makeApp(makeSynology(), makeToloka(), {
      getShowById: async () => DETAIL_SHOW,
    })
    const res = await app.request('/api/shows/1396', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; title: string; seasons: unknown[] }
    expect(body.id).toBe(1396)
    expect(body.title).toBe('Во все тяжкие')
    expect(body.seasons).toHaveLength(1)
  })

  it('GET /api/shows/:id self-heals poster and latestAiredEpisode for subscribed show', async () => {
    const sub: Subscription = { id: '1396', showId: 1396, title: 'Во все тяжкие' }
    let savedSub: Subscription | undefined
    const store = makeStore({
      listSubscriptions: () => [sub],
      getSubscription: () => sub,
      addSubscription: (s) => { savedSub = s },
    })
    const app = makeApp(makeSynology(), makeToloka(), {
      store,
      getShowById: async () => DETAIL_SHOW,
    })
    const res = await app.request('/api/shows/1396', { headers: ownerHeaders() })
    expect(res.status).toBe(200)
    // Self-heal should have written the poster
    expect(savedSub?.poster).toBe('https://myshows.me/img/1396.jpg')
  })

  it('GET /api/shows/:id 400 for non-integer id', async () => {
    const res = await makeApp().request('/api/shows/notanid', { headers: ownerHeaders() })
    expect(res.status).toBe(400)
  })

  it('GET /api/shows/:id 502 when myshows throws', async () => {
    const app = makeApp(makeSynology(), makeToloka(), { getShowById: async (): Promise<MyShowsShowDetailed> => { throw new Error('offline') } })
    const res = await app.request('/api/shows/1', { headers: ownerHeaders() })
    expect(res.status).toBe(502)
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
