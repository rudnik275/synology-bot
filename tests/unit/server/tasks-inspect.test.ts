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

describe('POST /api/tasks/inspect — create an inspecting task, return files', () => {
  it('requires auth', async () => {
    const res = await makeApp().request('/api/tasks/inspect', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('inspects a multipart .torrent upload and returns { listId, files }', async () => {
    let args: { name: string; dest: string; len: number } | undefined
    const app = makeApp(
      makeSynology({
        inspectTaskFromFile: async (bytes, name, dest) => {
          args = { name, dest, len: bytes.length }
          return {
            ok: true,
            data: {
              listId: 'LZ',
              files: [
                { index: 0, path: 'Show/S01E01.mkv', size: 100 },
                { index: 1, path: 'Show/S01E02.mkv', size: 200 },
              ],
            },
          }
        },
      })
    )
    const fd = new FormData()
    fd.append('destination', '/volume1/dl')
    fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/x-bittorrent' }), 'movie.torrent')
    const res = await app.request('/api/tasks/inspect', { method: 'POST', headers: ownerHeaders(), body: fd })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.listId).toBe('LZ')
    expect(body.files).toEqual([
      { index: 0, path: 'Show/S01E01.mkv', size: 100 },
      { index: 1, path: 'Show/S01E02.mkv', size: 200 },
    ])
    expect(args).toEqual({ name: 'movie.torrent', dest: '/volume1/dl', len: 4 })
  })

  it('inspects a Toloka URL by fetching its .torrent first', async () => {
    let inspected: { name: string; len: number } | undefined
    let downloadedUrl: string | undefined
    const synology = makeSynology({
      inspectTaskFromFile: async (bytes, name) => {
        inspected = { name, len: bytes.length }
        return { ok: true, data: { listId: 'LT', files: [] } }
      },
    })
    const toloka = makeToloka({ downloadTorrent: async (url) => { downloadedUrl = url; return new Uint8Array([9, 9]) } })
    const res = await makeApp(synology, toloka).request(
      '/api/tasks/inspect',
      jsonReq({ uri: 'https://toloka.to/download.php?id=7', title: 'The Matrix', destination: '/volume1/films' })
    )
    expect(res.status).toBe(200)
    expect(downloadedUrl).toBe('https://toloka.to/download.php?id=7')
    expect(inspected).toEqual({ name: 'The Matrix.torrent', len: 2 })
  })

  it('400 when neither a file nor a uri is provided', async () => {
    const res = await makeApp().request('/api/tasks/inspect', jsonReq({ destination: '/v1' }))
    expect(res.status).toBe(400)
  })

  it('400 when the source is a magnet (no local bytes to inspect)', async () => {
    const res = await makeApp().request('/api/tasks/inspect', jsonReq({ uri: 'magnet:?xt=1', destination: '/v1' }))
    expect(res.status).toBe(400)
  })

  it('502 when the inspect fails', async () => {
    const app = makeApp(makeSynology({ inspectTaskFromFile: async () => ({ ok: false, reason: 'inspect boom' }) }))
    const res = await app.request(
      '/api/tasks/inspect',
      jsonReq({ uri: 'https://toloka.to/download.php?id=7', destination: '/v1' })
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'inspect boom' })
  })
})

describe('POST /api/tasks/commit — complete the list (+ skip unwanted)', () => {
  it('forwards listId + skip indices to commitTaskSubset', async () => {
    let args: { listId: string; skip: number[] } | undefined
    const app = makeApp(
      makeSynology({ commitTaskSubset: async (listId, skip) => { args = { listId, skip: skip ?? [] }; return { ok: true } } })
    )
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'LZ', indices: [0, 2], skip: [1, 3] }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ listId: 'LZ', skip: [1, 3] })
  })

  it('all files selected (no skip) → still completes', async () => {
    let args: { listId: string; skip: number[] } | undefined
    const app = makeApp(
      makeSynology({ commitTaskSubset: async (listId, skip) => { args = { listId, skip: skip ?? [] }; return { ok: true } } })
    )
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'LZ', indices: [0, 1] }))
    expect(res.status).toBe(201)
    expect(args).toEqual({ listId: 'LZ', skip: [] })
  })

  it('400 when listId is missing', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ indices: [0] }))
    expect(res.status).toBe(400)
  })

  it('400 when indices is empty (a torrent with no selected files is invalid)', async () => {
    const res = await makeApp().request('/api/tasks/commit', jsonReq({ listId: 'L1', indices: [] }))
    expect(res.status).toBe(400)
  })

  it('502 when commit fails', async () => {
    const app = makeApp(makeSynology({ commitTaskSubset: async () => ({ ok: false, reason: 'commit boom' }) }))
    const res = await app.request('/api/tasks/commit', jsonReq({ listId: 'L1', indices: [0] }))
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
