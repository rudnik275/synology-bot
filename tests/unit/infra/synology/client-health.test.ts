import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'
import utilizationFixture from '../../../fixtures/synology/utilization.json'
import storageFixture from '../../../fixtures/synology/storage.json'
import disksFixture from '../../../fixtures/synology/disks.json'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SynologyClient health extensions', () => {
  const config = { host: 'http://nas.local:5000', user: 'admin', password: 'secret' }

  let fetchMock: ReturnType<typeof mock>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(mockResponse({ success: true, data: {} })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // Helper: set up client already logged in
  async function makeLoggedInClient(): Promise<SynologyClient> {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ success: true, data: { sid: 'test-sid' } }))
    )
    const client = new SynologyClient(config)
    await client.login()
    return client
  }

  // ─── getSystemUtilization ───────────────────────────────────────────────────

  describe('getSystemUtilization()', () => {
    it('returns typed CPU and memory data on success', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse(utilizationFixture))
      )

      const result = await client.getSystemUtilization()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.cpu.user_load).toBe(14)
        expect(result.data.cpu.system_load).toBe(5)
        expect(result.data.memory.real_usage).toBe(44)
        expect(result.data.memory.total_real).toBe(16384000)
        expect(result.data.memory.avail_real).toBe(9175040)
      }
    })

    it('triggers re-login and retry on error code 119', async () => {
      const client = await makeLoggedInClient()
      let callCount = 0

      fetchMock.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // session expired
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        if (callCount === 2) {
          // re-login
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'new-sid' } }))
        }
        // retry
        return Promise.resolve(mockResponse(utilizationFixture))
      })

      const result = await client.getSystemUtilization()
      expect(result.ok).toBe(true)
      expect(callCount).toBe(3)
    })

    it('returns {ok: false, reason} on transient (non-119) error', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 500 } }))
      )

      const result = await client.getSystemUtilization()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('500')
      }
    })
  })

  // ─── getStorageInfo ─────────────────────────────────────────────────────────

  describe('getStorageInfo()', () => {
    it('returns typed volume list on success', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse(storageFixture))
      )

      const result = await client.getStorageInfo()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.volumes).toHaveLength(2)
        const v1 = result.data.volumes[0]
        expect(v1.id).toBe('volume_1')
        expect(v1.vol_path).toBe('/volume1')
        expect(v1.size.total).toBe('4398046511104')
        expect(v1.size.used).toBe('1319413953331')
        expect(v1.status).toBe('normal')
      }
    })

    it('triggers re-login and retry on error code 119', async () => {
      const client = await makeLoggedInClient()
      let callCount = 0

      fetchMock.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        if (callCount === 2) {
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'new-sid' } }))
        }
        return Promise.resolve(mockResponse(storageFixture))
      })

      const result = await client.getStorageInfo()
      expect(result.ok).toBe(true)
      expect(callCount).toBe(3)
    })

    it('returns {ok: false, reason} on transient error', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 408 } }))
      )

      const result = await client.getStorageInfo()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('408')
      }
    })
  })

  // ─── getDiskInfo ────────────────────────────────────────────────────────────

  describe('getDiskInfo()', () => {
    it('returns typed disk list on success', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse(disksFixture))
      )

      const result = await client.getDiskInfo()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.disks).toHaveLength(2)
        const d1 = result.data.disks[0]
        expect(d1.id).toBe('sata1')
        expect(d1.model).toBe('WDC WD40EFRX')
        expect(d1.temp).toBe(38)
        expect(d1.status).toBe('normal')
        expect(d1.smart_status).toBe('normal')
      }
    })

    it('triggers re-login and retry on error code 119', async () => {
      const client = await makeLoggedInClient()
      let callCount = 0

      fetchMock.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
        }
        if (callCount === 2) {
          return Promise.resolve(mockResponse({ success: true, data: { sid: 'new-sid' } }))
        }
        return Promise.resolve(mockResponse(disksFixture))
      })

      const result = await client.getDiskInfo()
      expect(result.ok).toBe(true)
      expect(callCount).toBe(3)
    })

    it('returns {ok: false, reason} on transient error', async () => {
      const client = await makeLoggedInClient()

      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(mockResponse({ success: false, error: { code: 403 } }))
      )

      const result = await client.getDiskInfo()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('403')
      }
    })
  })
})
