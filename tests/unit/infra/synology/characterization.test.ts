/**
 * Characterization tests for SynologyClient — Theme 5 (#180) safety net.
 *
 * These pin the two risky, behavior-preserving surfaces BEFORE the refactor:
 *   1. the re-login/retry path (session-expired code 119 → exactly ONE re-login
 *      + a SINGLE retry, no infinite recursion; a second failure surfaces as
 *      `{ ok: false, reason }`).
 *   2. the exact DS2 `create`/`download` param encoding emitted by
 *      `createDownloadTask`, `createInspectList`, `commitInspectList` (the
 *      JSON-string-quoted foot-gun the `ds2CreateParams()` builder replaces).
 *
 * They are written against a stubbed `fetch` and assert the precise request
 * URL/params, so the refactor is provably behavior-preserving.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Parse the search params of a stubbed fetch call URL. */
function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('SynologyClient characterization (#180)', () => {
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

  // ─── re-login / retry path ──────────────────────────────────────────────────

  describe('re-login + single retry on session-expired (code 119)', () => {
    it('re-logins exactly once and retries the request exactly once', async () => {
      const calls: string[] = []
      let attempt = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('method=login')) {
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'fresh-sid' } }))
        }
        attempt++
        if (attempt === 1) {
          // first business request: session expired
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        // retry succeeds
        return Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
      })

      const result = await client.listTasks()

      expect(result.ok).toBe(true)
      // exactly one re-login
      expect(calls.filter((u) => u.includes('method=login'))).toHaveLength(1)
      // exactly two business attempts (original + single retry)
      expect(attempt).toBe(2)
      // total fetch calls: 1 (orig 119) + 1 (re-login) + 1 (retry) = 3
      expect(calls).toHaveLength(3)
    })

    it('retry carries the SAME api/method/params as the original request', async () => {
      const businessCalls: URLSearchParams[] = []
      let attempt = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'fresh-sid' } }))
        }
        businessCalls.push(paramsOf(url))
        attempt++
        if (attempt === 1) {
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        return Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
      })

      await client.listTasks()

      expect(businessCalls).toHaveLength(2)
      const [orig, retry] = businessCalls
      expect(orig.get('api')).toBe('SYNO.DownloadStation.Task')
      expect(orig.get('method')).toBe('list')
      expect(retry.get('api')).toBe(orig.get('api'))
      expect(retry.get('method')).toBe(orig.get('method'))
      expect(retry.get('additional')).toBe(orig.get('additional'))
      // retry uses the freshly-obtained SID
      expect(retry.get('_sid')).toBe('fresh-sid')
    })

    it('does NOT recurse: a SECOND 119 on the retry surfaces as { ok: false }', async () => {
      let loginCount = 0
      let attempt = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          loginCount++
          return Promise.resolve(mockResponse({ success: true, data: { sid: `sid-${loginCount}` } }))
        }
        attempt++
        // every business attempt fails with 119
        return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
      })

      const result = await client.listTasks()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('119')
      }
      // only ONE re-login happened (the retry path does not re-login again)
      expect(loginCount).toBe(1)
      // original attempt + single retry = 2 business attempts, then it gives up
      expect(attempt).toBe(2)
    })

    it('a non-session error (400) returns { ok: false, reason } WITHOUT re-login', async () => {
      let loginCount = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          loginCount++
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'x' } }))
        }
        return Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
      })

      const result = await client.listTasks()

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('400')
      expect(loginCount).toBe(0)
    })

    it.each([105, 106, 107])('session-expiry code %i re-logins once and retries, like 119', async (code) => {
      let loginCount = 0
      let attempt = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          loginCount++
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'fresh-sid' } }))
        }
        attempt++
        if (attempt === 1) {
          return Promise.resolve(mockResponse({ success: false, error: { code } }))
        }
        return Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
      })

      const result = await client.listTasks()

      expect(result.ok).toBe(true)
      expect(loginCount).toBe(1)
      expect(attempt).toBe(2)
    })

    it('a login failure during the retry surfaces as { ok: false } (no throw)', async () => {
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          return Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
        }
        return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
      })

      const result = await client.listTasks()

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('Re-login failed')
    })

    it('a network error in send() surfaces as { ok: false } (no throw)', async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error('connect ECONNREFUSED')))

      const result = await client.listTasks()

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('ECONNREFUSED')
    })

    it('concurrent session-expired requests share exactly ONE login fetch', async () => {
      let loginCount = 0
      let attempt = 0
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.includes('method=login')) {
          loginCount++
          // resolve on a later tick so both requests are waiting on the SAME login
          return new Promise((resolve) =>
            setTimeout(() => resolve(mockResponse({ success: true, data: { sid: 'fresh-sid' } })), 10),
          )
        }
        attempt++
        if (attempt <= 2) {
          // both first attempts hit session-expired
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        return Promise.resolve(mockResponse({ success: true, data: { tasks: [], total: 0, offset: 0 } }))
      })

      const [a, b] = await Promise.all([client.listTasks(), client.listTasks()])

      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect(loginCount).toBe(1)
    })
  })

  // ─── exact DS2 create / download param encoding ──────────────────────────────

  describe('DS2 create/commit param encoding (the quoted-JSON foot-gun)', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=TestShow'

    function lastParams(): URLSearchParams {
      const url = String((fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [unknown])[0])
      return paramsOf(url)
    }

    it('createDownloadTask emits type:"url", url JSON-array, destination quoted, create_list:false', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))

      await client.createDownloadTask(magnet, '/volume1/video')

      const p = lastParams()
      expect(p.get('api')).toBe('SYNO.DownloadStation2.Task')
      expect(p.get('version')).toBe('2')
      expect(p.get('method')).toBe('create')
      expect(p.get('create_list')).toBe('false')
      // exact quoted-JSON values
      expect(p.get('type')).toBe('"url"')
      expect(p.get('url')).toBe(JSON.stringify([magnet]))
      // /volume1/ + leading slash stripped, then JSON-quoted
      expect(p.get('destination')).toBe('"video"')
    })

    it('createDownloadTask returns the created task_id (for optimistic-card cancel)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { task_id: ['dbid_new'] } })),
      )

      const result = await client.createDownloadTask(magnet, '/volume1/video')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.id).toBe('dbid_new')
    })

    it('createDownloadTask returns id:undefined when DSM omits task_id', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))

      const result = await client.createDownloadTask(magnet, '/volume1/video')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.id).toBeUndefined()
    })

    it('createInspectList emits create_list:true with the same quoted-JSON shape', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { list_id: ['L-1'] } })),
      )

      const result = await client.createInspectList(magnet, '/volume1/video/Movies')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.listId).toBe('L-1')

      const p = lastParams()
      expect(p.get('api')).toBe('SYNO.DownloadStation2.Task')
      expect(p.get('version')).toBe('2')
      expect(p.get('method')).toBe('create')
      expect(p.get('create_list')).toBe('true')
      expect(p.get('type')).toBe('"url"')
      expect(p.get('url')).toBe(JSON.stringify([magnet]))
      expect(p.get('destination')).toBe('"video/Movies"')
    })

    it('commitInspectList emits Task.List download with list_id, selected, destination', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { task_id: ['T-1'] } })),
      )

      const result = await client.commitInspectList('list-xyz', [0, 2, 5], '/volume1/video')
      expect(result.ok).toBe(true)
      // The committed task_id is echoed back for optimistic-card cancel.
      if (result.ok) expect(result.id).toBe('T-1')

      const p = lastParams()
      expect(p.get('api')).toBe('SYNO.DownloadStation2.Task.List')
      expect(p.get('version')).toBe('2')
      expect(p.get('method')).toBe('download')
      // list_id is a JSON string (quoted), selected is a JSON array, destination quoted
      expect(p.get('list_id')).toBe(JSON.stringify('list-xyz'))
      expect(p.get('selected')).toBe(JSON.stringify([0, 2, 5]))
      expect(p.get('destination')).toBe('"video"')
    })

    it('getInspectList emits Task.List get with list_id as a JSON string', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: { files: [], title: 't', size: 0, type: 'x' } })),
      )

      await client.getInspectList('list-abc')

      const p = lastParams()
      expect(p.get('api')).toBe('SYNO.DownloadStation2.Task.List')
      expect(p.get('method')).toBe('get')
      expect(p.get('list_id')).toBe(JSON.stringify('list-abc'))
    })

    it('deleteInspectList emits Task.List delete with list_id as a JSON ARRAY', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ success: true, data: {} })))

      await client.deleteInspectList('list-del')

      const p = lastParams()
      expect(p.get('api')).toBe('SYNO.DownloadStation2.Task.List')
      expect(p.get('method')).toBe('delete')
      // delete wants the list_id wrapped in a JSON array, unlike get/download
      expect(p.get('list_id')).toBe(JSON.stringify(['list-del']))
    })
  })
})
