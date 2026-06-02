// Endpoint tests for the two-phase selective-download flow (#123):
//   POST   /api/tasks/inspect  — create_list=true → { listId, files }
//   POST   /api/tasks/commit   — { listId, indices } → set subset + Complete
//   DELETE /api/tasks/inspect/:listId — cancel an uncommitted inspect
//
// Mirrors the makeApp/ownerHeaders setup in server.test.ts.
import { describe, it, expect } from 'bun:test'
import { createServer, type SubscriptionStore } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import type { Task } from '../../../src/infra/synology/types.ts'
import type { TolokaResult } from '../../../src/infra/toloka/types.ts'
import type { MyShowsShowDetailed } from '../../../src/infra/myshows/client.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeSynology(overrides: Partial<SynologyClient> = {}): SynologyClient {
  const base = {
    listTasks: async () => ({ ok: true as const, data: [] as Task[] }),
    createDownloadTask: async () => ({ ok: true as const }),
    createDownloadTaskFromFile: async () => ({ ok: true as const }),
    inspectTaskFromFile: async () => ({ ok: true as const, data: { listId: 'L1', files: [] } }),
    commitTaskSubset: async () => ({ ok: true as const }),
    cancelTaskList: async () => ({ ok: true as const }),
    listSharedFolders: async () => ({ ok: true as const, data: [] }),
    listFolders: async () => ({ ok: true as const, data: [] }),
    getSystemUtilization: async () => ({ ok: true as const, data: { cpu: { user_load: 0, system_load: 0 }, memory: { real_usage: 0, total_real: 0, avail_real: 0 } } }),
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

function makeStore(): SubscriptionStore {
  return {
    listSubscriptions: () => [],
    getSubscription: () => undefined,
    addSubscription: () => {},
    removeSubscription: () => {},
  }
}

function makeDocker(): DockerClient {
  return {
    getContainerByName: async () => null,
    getContainerLogs: async () => '',
  } as unknown as DockerClient
}

function makeApp(synology: SynologyClient = makeSynology(), toloka: TolokaClient = makeToloka()) {
  return createServer({
    synology,
    toloka,
    docker: makeDocker(),
    store: makeStore(),
    getShowById: async () => ({ id: 1, title: 'X', episodes: [] }) as MyShowsShowDetailed,
    getTodayEpisodes: async () => [],
    searchShows: async () => [],
    tolokaBaseUrl: 'https://toloka.to',
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

describe('POST /api/tasks/inspect — neutralized (per-file selection retired)', () => {
  it('requires auth', async () => {
    const res = await makeApp().request('/api/tasks/inspect', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  // The inspect/create_list=true upload was itself the source of stuck empty
  // tasks (and a second Toloka fetch per add). It now returns an empty preview
  // WITHOUT touching the NAS or Toloka; the confirm step shows a whole-torrent add.
  it('returns an empty preview for a Toloka URL without hitting the NAS or Toloka', async () => {
    let inspectCalled = false
    let downloaded = false
    const synology = makeSynology({ inspectTaskFromFile: async () => { inspectCalled = true; return { ok: true, data: { listId: 'L', files: [] } } } })
    const toloka = makeToloka({ downloadTorrent: async () => { downloaded = true; return new Uint8Array([1]) } })
    const res = await makeApp(synology, toloka).request(
      '/api/tasks/inspect',
      jsonReq({ uri: 'https://toloka.to/download.php?id=7', title: 'The Matrix', destination: '/volume1/films' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ listId: null, files: [] })
    expect(inspectCalled).toBe(false)
    expect(downloaded).toBe(false)
  })

  it('returns an empty preview for a multipart upload too', async () => {
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/x-bittorrent' }), 'movie.torrent')
    const res = await makeApp().request('/api/tasks/inspect', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ listId: null, files: [] })
  })
})

describe('POST /api/tasks/commit — start the selected files (Task.List.Polling download)', () => {
  it('forwards listId + selected indices + destination to commitTaskSubset', async () => {
    let args: { listId: string; indices: number[]; destination: string } | undefined
    const app = makeApp(
      makeSynology({ commitTaskSubset: async (listId, indices, destination) => { args = { listId, indices, destination }; return { ok: true } } })
    )
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'LZ', indices: [0, 2], destination: '/volume1/video' }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ listId: 'LZ', indices: [0, 2], destination: '/volume1/video' })
  })

  it('400 when listId is missing', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ indices: [0], destination: '/v' }))
    expect(res.status).toBe(400)
  })

  it('400 when indices is empty (a torrent with no selected files is invalid)', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ listId: 'L1', indices: [], destination: '/v' }))
    expect(res.status).toBe(400)
  })

  it('400 when destination is missing', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ listId: 'L1', indices: [0] }))
    expect(res.status).toBe(400)
  })

  it('502 when commit fails', async () => {
    const app = makeApp(makeSynology({ commitTaskSubset: async () => ({ ok: false, reason: 'commit boom' }) }))
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'L1', indices: [0], destination: '/v' }))
    expect(res.status).toBe(502)
  })
})

describe('DELETE /api/tasks/inspect/:listId — cancel an uncommitted inspect', () => {
  it('forwards the listId to cancelTaskList', async () => {
    let cancelled: string | undefined
    const app = makeApp(makeSynology({ cancelTaskList: async (id) => { cancelled = id; return { ok: true } } }))
    const res = await app.request('/api/tasks/inspect/LX', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(200)
    expect(cancelled).toBe('LX')
  })

  it('502 when cancel fails', async () => {
    const app = makeApp(makeSynology({ cancelTaskList: async () => ({ ok: false, reason: 'cancel boom' }) }))
    const res = await app.request('/api/tasks/inspect/LX', { method: 'DELETE', headers: ownerHeaders() })
    expect(res.status).toBe(502)
  })
})
