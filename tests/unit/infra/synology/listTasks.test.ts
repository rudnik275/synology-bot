import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const RAW_TASKS = [
  {
    id: 'dbid_abc123',
    title: 'MyFile.mkv',
    status: 'finished',
    size: 1_000_000,
    additional: {
      detail: { destination: '/volume1/downloads', uri: 'magnet:?xt=...' },
      transfer: { size_downloaded: 1_000_000, speed_download: 0 },
    },
  },
  {
    id: 'dbid_def456',
    title: 'AnotherFile.zip',
    status: 'downloading',
    size: 500_000,
    additional: {
      detail: { destination: '/volume1/downloads' },
      transfer: { size_downloaded: 200_000, speed_download: 1024 },
    },
  },
]

describe('SynologyClient.listTasks', () => {
  const config = { host: 'http://nas.local:5000', user: 'admin', password: 'secret' }

  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(mockResponse({ success: true, data: {} })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('listTasks returns Task[] on success', async () => {
    let loginDone = false
    fetchMock.mockImplementation(() => {
      if (!loginDone) {
        loginDone = true
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-x' } }))
      }
      return Promise.resolve(mockResponse({
        success: true,
        data: { tasks: RAW_TASKS, total: 2, offset: 0 },
      }))
    })

    const client = new SynologyClient(config)
    await client.login()
    const result = await client.listTasks()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].id).toBe('dbid_abc123')
      expect(result.data[0].status).toBe('finished')
      expect(result.data[1].status).toBe('downloading')
    }
  })

  it('listTasks error 119 triggers re-login and retry', async () => {
    let callCount = 0
    fetchMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-v1' } }))
      if (callCount === 2) return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
      if (callCount === 3) return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-v2' } }))
      return Promise.resolve(mockResponse({ success: true, data: { tasks: RAW_TASKS, total: 2, offset: 0 } }))
    })

    const client = new SynologyClient(config)
    await client.login()
    const result = await client.listTasks()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toHaveLength(2)
    }
    expect(callCount).toBe(4)
  })

  it('listTasks returns error result on non-119 failure', async () => {
    let loginDone = false
    fetchMock.mockImplementation(() => {
      if (!loginDone) {
        loginDone = true
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-x' } }))
      }
      return Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
    })

    const client = new SynologyClient(config)
    await client.login()
    const result = await client.listTasks()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('400')
    }
  })

  it('listTasks uses additional=detail,transfer param', async () => {
    let loginDone = false
    fetchMock.mockImplementation(() => {
      if (!loginDone) {
        loginDone = true
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-y' } }))
      }
      return Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
    })

    const client = new SynologyClient(config)
    await client.login()
    await client.listTasks()

    const lastUrl = (fetchMock.mock.calls[1] as [string])[0]
    expect(lastUrl).toContain('additional=detail%2Ctransfer')
    expect(lastUrl).toContain('SYNO.DownloadStation.Task')
    expect(lastUrl).toContain('method=list')
  })
})
