import { describe, it, expect } from 'bun:test'
import { createServer } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { Task } from '../../../src/infra/synology/types.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeSynology(overrides: Partial<SynologyClient> = {}): SynologyClient {
  const base = {
    listTasks: async () => ({ ok: true as const, data: [] as Task[] }),
    getSystemUtilization: async () => ({ ok: true as const, data: { cpu: { user_load: 1, system_load: 2 }, memory: { real_usage: 30, total_real: 1000, avail_real: 700 } } }),
    getStorageInfo: async () => ({ ok: true as const, data: { volumes: [] } }),
    getDiskInfo: async () => ({ ok: true as const, data: { disks: [] } }),
    getProcessGroups: async () => ({ ok: true as const, data: [] }),
  }
  return { ...base, ...overrides } as unknown as SynologyClient
}

function makeApp(synology: SynologyClient = makeSynology()) {
  return createServer({ synology, botToken: TEST_BOT_TOKEN, ownerId: OWNER_ID, initDataMaxAgeSeconds: 0 })
}

function ownerHeaders() {
  return { Authorization: `tma ${buildInitData({ id: OWNER_ID })}` }
}

describe('Mini App server', () => {
  it('GET /healthz is open and returns ok', async () => {
    const res = await makeApp().request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/tasks requires auth', async () => {
    const res = await makeApp().request('/api/tasks')
    expect(res.status).toBe(401)
  })

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
