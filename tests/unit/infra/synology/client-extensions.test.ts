import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SynologyClient extensions', () => {
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
    // Reset after login
    fetchMock.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('createDownloadTask()', () => {
    it('returns ok:true on success', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      const result = await client.createDownloadTask(
        'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '/volume1/video'
      )
      expect(result.ok).toBe(true)
    })

    it('calls SYNO.DownloadStation2.Task create type:"url" with correct params', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: true, data: {} }))
      )

      const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=TestShow'
      await client.createDownloadTask(magnet, '/volume1/video')

      const calledUrl: string = (fetchMock.mock.calls[0] as [string])[0]
      // DS2 type:"url" is the only create that actually parses a .torrent URL (verified live).
      expect(calledUrl).toContain('SYNO.DownloadStation2.Task')
      expect(calledUrl).toContain('method=create')
      expect(calledUrl).toContain('create_list=false')
      // DS2 entry.cgi wants JSON-encoded values: type "url", url ["…"], destination "…".
      expect(calledUrl).toContain(`type=${encodeURIComponent('"url"')}`)
      expect(calledUrl).toContain(encodeURIComponent(JSON.stringify([magnet])))
      // destination is normalized (/volume1/ + leading slash stripped) and JSON-quoted.
      expect(calledUrl).toContain(`destination=${encodeURIComponent('"video"')}`)
    })

    it('returns ok:false with reason on Synology error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
      )

      const result = await client.createDownloadTask(
        'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '/volume1/video'
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('400')
      }
    })
  })

  describe('listSharedFolders()', () => {
    it('returns list of share names on success', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse({
            success: true,
            data: {
              shares: [
                { name: 'video', path: '/volume1/video' },
                { name: 'music', path: '/volume1/music' },
              ],
            },
          })
        )
      )

      const result = await client.listSharedFolders()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([
          { name: 'video', path: '/volume1/video' },
          { name: 'music', path: '/volume1/music' },
        ])
      }
    })

    it('calls SYNO.FileStation.List list_share method', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse({ success: true, data: { shares: [] } })
        )
      )

      await client.listSharedFolders()

      const calledUrl: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(calledUrl).toContain('SYNO.FileStation.List')
      expect(calledUrl).toContain('method=list_share')
    })

    it('returns ok:false on error', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 408 } }))
      )

      const result = await client.listSharedFolders()
      expect(result.ok).toBe(false)
    })
  })

  describe('listFolders()', () => {
    it('returns subfolders for a given path', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse({
            success: true,
            data: {
              files: [
                { name: 'TV Shows', path: '/volume1/video/TV Shows', isdir: true },
                { name: 'Movies', path: '/volume1/video/Movies', isdir: true },
              ],
            },
          })
        )
      )

      const result = await client.listFolders('/volume1/video')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(2)
        expect(result.data[0].name).toBe('TV Shows')
      }
    })

    it('calls SYNO.FileStation.List list with folder_path', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse({ success: true, data: { files: [] } })
        )
      )

      await client.listFolders('/volume1/video')

      const calledUrl: string = (fetchMock.mock.calls[0] as [string])[0]
      expect(calledUrl).toContain('SYNO.FileStation.List')
      expect(calledUrl).toContain('method=list')
      expect(calledUrl).toContain(encodeURIComponent('/volume1/video'))
    })
  })
})
