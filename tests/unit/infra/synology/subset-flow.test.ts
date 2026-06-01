// Two-phase selective-download flow on SynologyClient (#123).
//
// Verified API surface (live NAS, DSM 7): create(create_list=true) → list_id;
// Task.List `get` → files; Task.BT.File → set subset; Task.Complete → commit;
// Task.List `delete` → cancel an uncommitted inspect. These tests pin the
// method/api/version + that the selected subset is forwarded, with MOCKED Fapi
// (fetch) responses.
//
// ⚠ The BT.File / Complete WRITE payload shapes are best-faithful (the probe was
// read-only) and need a live-NAS confirmation pass post-deploy. If the live
// shape differs, only the client method bodies + these assertions change.
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Read multipart FormData out of a captured fetch call. */
function formOf(call: unknown): FormData {
  const init = (call as [string, RequestInit])[1]
  return init.body as FormData
}

describe('SynologyClient — selective-download two-phase flow (#123)', () => {
  const config = { host: 'http://nas.local:5000', user: 'admin', password: 'secret' }
  const torrentBytes = new Uint8Array([1, 2, 3, 4])

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

  // ─── Phase 1: create with create_list=true → list_id ───────────────────────
  describe('inspectTaskFromFile()', () => {
    it('creates with create_list=true and returns the list_id + normalized files', async () => {
      let createCount = 0
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        const form = init?.body
        if (form instanceof FormData && form.get('method') === 'create') {
          createCount++
          return Promise.resolve(mockResponse({ success: true, data: { list_id: ['L42'] } }))
        }
        // Task.List get
        return Promise.resolve(
          mockResponse({
            success: true,
            data: {
              files: [
                { index: 0, name: 'Show/S01E01.mkv', size: 100 },
                { index: 1, name: 'Show/S01E02.mkv', size: '200' },
              ],
            },
          })
        )
      })

      const result = await client.inspectTaskFromFile(torrentBytes, 'Show.torrent', '/volume1/video')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.listId).toBe('L42')
      expect(result.data.files).toEqual([
        { index: 0, path: 'Show/S01E01.mkv', size: 100 },
        { index: 1, path: 'Show/S01E02.mkv', size: 200 },
      ])
      expect(createCount).toBe(1)
    })

    it('sends create_list="true" + share-relative destination on the create call', async () => {
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        const form = init?.body
        if (form instanceof FormData && form.get('method') === 'create') {
          return Promise.resolve(mockResponse({ success: true, data: { list_id: ['L1'] } }))
        }
        return Promise.resolve(mockResponse({ success: true, data: { files: [] } }))
      })

      await client.inspectTaskFromFile(torrentBytes, 'X.torrent', '/volume1/video', { pollDelayMs: 0, maxPolls: 1 })

      const createCall = fetchMock.mock.calls.find(
        (c) => formOf(c) instanceof FormData && formOf(c).get('method') === 'create'
      )!
      const form = formOf(createCall)
      expect(form.get('api')).toBe('SYNO.DownloadStation2.Task')
      expect(form.get('create_list')).toBe('true')
      // destination normalized: /volume1/video → "video" (quoted JSON string)
      expect(form.get('destination')).toBe('"video"')
    })

    it('polls Task.List while the list is still inspecting, then returns the resolved files', async () => {
      let getCount = 0
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const form = init?.body
        if (form instanceof FormData && form.get('method') === 'create') {
          return Promise.resolve(mockResponse({ success: true, data: { list_id: ['LP'] } }))
        }
        getCount++
        if (getCount < 3) {
          // still resolving metadata: empty + inspecting
          return Promise.resolve(mockResponse({ success: true, data: { files: [], inspecting: true } }))
        }
        return Promise.resolve(
          mockResponse({ success: true, data: { files: [{ index: 0, name: 'a.mkv', size: 1 }], inspecting: false } })
        )
      })

      const result = await client.inspectTaskFromFile(torrentBytes, 'M.torrent', '/v', { pollDelayMs: 0, maxPolls: 5 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.files).toHaveLength(1)
        expect(getCount).toBeGreaterThanOrEqual(3)
      }
    })

    it('returns ok:false if create fails (no list_id)', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: false, error: { code: 408 } })))
      const result = await client.inspectTaskFromFile(torrentBytes, 'X.torrent', '/v')
      expect(result.ok).toBe(false)
    })
  })

  // ─── Phase 3: BT.File set subset ───────────────────────────────────────────
  describe('selectTaskFiles()', () => {
    it('calls SYNO.DownloadStation2.Task.BT.File with the list_id and the selected index subset', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))
      const result = await client.selectTaskFiles('L42', [0, 2, 3])
      expect(result.ok).toBe(true)

      const call = fetchMock.mock.calls[0]
      const form = formOf(call)
      expect(form.get('api')).toBe('SYNO.DownloadStation2.Task.BT.File')
      expect(form.get('method')).toBe('set')
      expect(form.get('list_id')).toBe('"L42"')
      // Selected subset forwarded as a JSON array of indices.
      expect(form.get('index')).toBe('[0,2,3]')
    })

    it('returns ok:false on a Synology error', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: false, error: { code: 400 } })))
      const result = await client.selectTaskFiles('L42', [0])
      expect(result.ok).toBe(false)
    })
  })

  // ─── Phase 4: Complete ─────────────────────────────────────────────────────
  describe('completeTaskList()', () => {
    it('calls SYNO.DownloadStation2.Task.Complete with the list_id', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))
      const result = await client.completeTaskList('L42')
      expect(result.ok).toBe(true)

      const form = formOf(fetchMock.mock.calls[0])
      expect(form.get('api')).toBe('SYNO.DownloadStation2.Task.Complete')
      expect(form.get('method')).toBe('start')
      expect(form.get('list_id')).toBe('"L42"')
    })
  })

  // ─── Phase 5: cancel (List delete) ─────────────────────────────────────────
  describe('cancelTaskList()', () => {
    it('calls SYNO.DownloadStation2.Task.List delete with the list_id', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))
      const result = await client.cancelTaskList('L42')
      expect(result.ok).toBe(true)

      const form = formOf(fetchMock.mock.calls[0])
      expect(form.get('api')).toBe('SYNO.DownloadStation2.Task.List')
      expect(form.get('method')).toBe('delete')
      expect(form.get('list_id')).toBe('"L42"')
    })
  })

  // ─── End-to-end commit subset ──────────────────────────────────────────────
  it('commitTaskSubset() sets the subset then completes, in order', async () => {
    const seq: string[] = []
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      seq.push(form.get('api') as string)
      return Promise.resolve(mockResponse({ success: true, data: {} }))
    })

    const result = await client.commitTaskSubset('L9', [1, 4])
    expect(result.ok).toBe(true)
    expect(seq).toEqual(['SYNO.DownloadStation2.Task.BT.File', 'SYNO.DownloadStation2.Task.Complete'])
  })

  it('commitTaskSubset() does NOT complete if the subset selection fails', async () => {
    const seq: string[] = []
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      seq.push(form.get('api') as string)
      return Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
    })

    const result = await client.commitTaskSubset('L9', [1])
    expect(result.ok).toBe(false)
    expect(seq).toEqual(['SYNO.DownloadStation2.Task.BT.File'])
  })
})
