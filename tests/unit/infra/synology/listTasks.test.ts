import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SynologyClient — task list and actions', () => {
  const config = { host: 'http://nas.local:5000', user: 'admin', password: 'secret' }

  let fetchMock: ReturnType<typeof mock>
  let originalFetch: typeof globalThis.fetch
  let client: SynologyClient

  beforeEach(async () => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(mockResponse({ success: true, data: { sid: 'test-sid' } })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    client = new SynologyClient(config)
    await client.login()
    fetchMock.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ---- listTasks ----

  describe('listTasks()', () => {
    it('returns task list on success', async () => {
      const tasks: Task[] = [
        { id: 'task-1', title: 'My Movie', status: 'downloading', size: 1000 },
        { id: 'task-2', title: 'My Show', status: 'finished', size: 500 },
      ]

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse({ success: true, data: { tasks, total: 2, offset: 0 } })
        )
      )

      const result = await client.listTasks()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(2)
        expect(result.data[0].id).toBe('task-1')
      }
    })

    it('sends additional=detail,transfer param', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
      )

      await client.listTasks()

      const url: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(url).toContain('SYNO.DownloadStation.Task')
      expect(url).toContain('method=list')
      expect(url).toContain('additional=detail%2Ctransfer')
    })

    it('returns ok:false on Synology error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
      )

      const result = await client.listTasks()
      expect(result.ok).toBe(false)
    })

    it('returns empty array when tasks field is missing', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { total: 0, offset: 0 } }))
      )

      const result = await client.listTasks()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })
  })

  // ---- pauseTask ----

  describe('pauseTask()', () => {
    it('returns ok:true on success', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      const result = await client.pauseTask('task-123')
      expect(result.ok).toBe(true)
    })

    it('sends pause method with task id', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      await client.pauseTask('task-abc')

      const url: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(url).toContain('SYNO.DownloadStation.Task')
      expect(url).toContain('method=pause')
      expect(url).toContain('id=task-abc')
    })

    it('returns ok:false on Synology error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
      )

      const result = await client.pauseTask('task-123')
      expect(result.ok).toBe(false)
    })
  })

  // ---- resumeTask ----

  describe('resumeTask()', () => {
    it('returns ok:true on success', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      const result = await client.resumeTask('task-123')
      expect(result.ok).toBe(true)
    })

    it('sends resume method with task id', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      await client.resumeTask('task-xyz')

      const url: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(url).toContain('SYNO.DownloadStation.Task')
      expect(url).toContain('method=resume')
      expect(url).toContain('id=task-xyz')
    })

    it('returns ok:false on Synology error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 500 } }))
      )

      const result = await client.resumeTask('task-123')
      expect(result.ok).toBe(false)
    })
  })

  // ---- deleteTask ----

  describe('deleteTask()', () => {
    it('returns ok:true on success', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      const result = await client.deleteTask('task-123')
      expect(result.ok).toBe(true)
    })

    it('sends delete method with task id and force_complete=false', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      await client.deleteTask('task-del')

      const url: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(url).toContain('SYNO.DownloadStation.Task')
      expect(url).toContain('method=delete')
      expect(url).toContain('id=task-del')
      expect(url).toContain('force_complete=false')
    })

    it('returns ok:false on Synology error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 408 } }))
      )

      const result = await client.deleteTask('task-123')
      expect(result.ok).toBe(false)
    })
  })
})
