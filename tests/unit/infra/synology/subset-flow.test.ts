// Two-phase selective-download flow on SynologyClient (#123, #1).
//
// Verified API surface (live NAS, DSM 7): create(create_list=true) → list_id;
// Task.List `get` → files; Task.BT.File → set subset; Task.Complete → commit;
// Task.List `delete` → cancel an uncommitted inspect.
//
// DSM-7 transport (pinned on the live NAS, #1):
//   - create-from-file goes to entry.cgi as multipart with a BROWSER-style
//     boundary, _sid in the QUERY, and the bytes in a `torrent` part referenced
//     by `file=["torrent"]`. DSM drops every field of a generic-boundary body.
//   - the list/select/complete/cancel calls carry their params in the QUERY
//     string (entry.cgi likewise ignores multipart-body params there).
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const urlOf = (call: unknown): string => (call as [string, RequestInit?])[0]
const initOf = (call: unknown): RequestInit | undefined => (call as [string, RequestInit?])[1]
/** A create-from-file call is the only one with a request body (the multipart). */
const isCreate = (call: unknown): boolean => Boolean(initOf(call)?.body)
const bodyText = (call: unknown): string =>
  new TextDecoder().decode(initOf(call)!.body as Uint8Array)
/** Pull a multipart field value out of a decoded browser-multipart body. */
function field(body: string, name: string): string | null {
  const m = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`))
  return m ? m[1]! : null
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
        if (init?.body) {
          createCount++
          return Promise.resolve(mockResponse({ success: true, data: { list_id: ['L42'] } }))
        }
        // Task.List get (query-param call, no body)
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

    it('sends a browser-boundary multipart with _sid in the query, create_list="true" + share-relative destination', async () => {
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.body) return Promise.resolve(mockResponse({ success: true, data: { list_id: ['L1'] } }))
        return Promise.resolve(mockResponse({ success: true, data: { files: [] } }))
      })

      await client.inspectTaskFromFile(torrentBytes, 'X.torrent', '/volume1/video', { pollDelayMs: 0, maxPolls: 1 })

      const createCall = fetchMock.mock.calls.find(isCreate)!
      // _sid travels in the query, NOT the body.
      expect(urlOf(createCall)).toContain('/webapi/entry.cgi?_sid=test-sid')
      const ct = (initOf(createCall)!.headers as Record<string, string>)['Content-Type']
      expect(ct).toContain('multipart/form-data; boundary=----WebKitFormBoundary')
      const body = bodyText(createCall)
      expect(field(body, 'api')).toBe('SYNO.DownloadStation2.Task')
      expect(field(body, 'create_list')).toBe('true')
      // destination normalized: /volume1/video → "video" (quoted JSON string)
      expect(field(body, 'destination')).toBe('"video"')
      // file is the JSON array naming the bytes part; the bytes live in `torrent`.
      expect(field(body, 'file')).toBe('["torrent"]')
      expect(body).toContain('name="torrent"; filename="X.torrent"')
      expect(body).not.toContain('name="_sid"')
    })

    it('polls Task.List while the list is still inspecting, then returns the resolved files', async () => {
      let getCount = 0
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.body) return Promise.resolve(mockResponse({ success: true, data: { list_id: ['LP'] } }))
        getCount++
        if (getCount < 3) {
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

  // ─── Cancel (List delete, query params) ────────────────────────────────────
  describe('cancelTaskList()', () => {
    it('calls SYNO.DownloadStation2.Task.List delete with the list_id', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))
      const result = await client.cancelTaskList('L42')
      expect(result.ok).toBe(true)

      const url = decodeURIComponent(urlOf(fetchMock.mock.calls[0]))
      expect(url).toContain('api=SYNO.DownloadStation2.Task.List')
      expect(url).toContain('method=delete')
      expect(url).toContain('list_id="L42"')
    })
  })

  // ─── Commit via Task.List.Polling download → poll download_status → stop ────
  describe('commitTaskSubset()', () => {
    // route a Polling call by its method (order matters: _status / _stop before plain download)
    function routePolling(url: string): 'download' | 'download_status' | 'download_stop' | 'other' {
      const u = decodeURIComponent(url)
      if (u.includes('method=download_status')) return 'download_status'
      if (u.includes('method=download_stop')) return 'download_stop'
      if (u.includes('method=download')) return 'download'
      return 'other'
    }

    it('downloads the selection, polls download_status until finish, then download_stop', async () => {
      const seq: string[] = []
      let statusPolls = 0
      fetchMock.mockImplementation((url: string) => {
        const r = routePolling(url)
        seq.push(r)
        if (r === 'download') return Promise.resolve(mockResponse({ success: true, data: { task_id: 'op-1' } }))
        if (r === 'download_status') { statusPolls++; return Promise.resolve(mockResponse({ success: true, data: { finish: statusPolls >= 2 } })) }
        return Promise.resolve(mockResponse({ success: true, data: {} }))
      })

      const result = await client.commitTaskSubset('L9', [0, 2], '/volume1/video/сериалы', { pollDelayMs: 0, maxPolls: 5 })
      expect(result.ok).toBe(true)
      // first call is download with the selection; then status polls (until finish); then stop
      expect(seq[0]).toBe('download')
      expect(seq[seq.length - 1]).toBe('download_stop')
      expect(seq.filter((s) => s === 'download_status').length).toBe(2)

      const dl = decodeURIComponent(urlOf(fetchMock.mock.calls[0]))
      expect(dl).toContain('api=SYNO.DownloadStation2.Task.List.Polling')
      expect(dl).toContain('list_id="L9"')
      // selection is `selected` (a JSON array of wanted indices), NOT file_indexes
      expect(dl).toContain('selected=[0,2]')
      expect(dl).toContain('destination="video/сериалы"')
      expect(dl).toContain('create_subfolder=true')
      // status + stop both target the operation task_id
      const stop = decodeURIComponent(urlOf(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]))
      expect(stop).toContain('method=download_stop')
      expect(stop).toContain('task_id="op-1"')
    })

    it('returns ok:false when the initial download fails', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 120 } })))
      const result = await client.commitTaskSubset('L9', [1], '/volume1/video', { pollDelayMs: 0 })
      expect(result.ok).toBe(false)
    })
  })
})
