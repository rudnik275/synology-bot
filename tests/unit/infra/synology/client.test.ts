import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { SynologyClient } from '../../../../src/infra/synology/client.ts'

// Helper to create a JSON response mock
function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SynologyClient', () => {
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

  // --- Cycle 4: successful login stores SID ---
  it('login() stores the SID returned by Synology auth endpoint', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(mockResponse({ success: true, data: { sid: 'test-sid-123' } }))
    )

    const client = new SynologyClient(config)
    await client.login()

    // Verify the SID is used in subsequent requests
    fetchMock.mockImplementation(() =>
      Promise.resolve(mockResponse({ success: true, data: { result: 'ok' } }))
    )

    await client.isReachable()

    // The second call should include _sid param
    const lastCallUrl = (fetchMock.mock.calls[1] as [string])[0]
    expect(lastCallUrl).toContain('_sid=test-sid-123')
  })

  // --- Cycle 5: error-119 triggers relogin + retry ---
  it('request() on error code 119 re-logins once and retries', async () => {
    let callCount = 0
    fetchMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First login
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-v1' } }))
      }
      if (callCount === 2) {
        // First actual request — returns 119 (session expired)
        return Promise.resolve(mockResponse({ success: false, error: { code: 119 } }))
      }
      if (callCount === 3) {
        // Re-login
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-v2' } }))
      }
      // Retry of original request — success
      return Promise.resolve(mockResponse({ success: true, data: {} }))
    })

    const client = new SynologyClient(config)
    await client.login()

    const result = await client.isReachable()
    expect(result.ok).toBe(true)
    // Total calls: initial login + isReachable attempt + relogin + retry = 4
    expect(callCount).toBe(4)
  })

  // --- Cycle 6: non-119 error returns explicit error, no crash ---
  it('request() on non-119 error code returns an error result without throwing', async () => {
    let loginDone = false
    fetchMock.mockImplementation(() => {
      if (!loginDone) {
        loginDone = true
        return Promise.resolve(mockResponse({ success: true, data: { sid: 'sid-abc' } }))
      }
      // Non-119 error (e.g. 400 = invalid parameter)
      return Promise.resolve(mockResponse({ success: false, error: { code: 400 } }))
    })

    const client = new SynologyClient(config)
    await client.login()

    const result = await client.isReachable()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('400')
    }
  })

  it('login() POST includes api, method, account, passwd, session params', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(mockResponse({ success: true, data: { sid: 'x' } }))
    )

    const client = new SynologyClient(config)
    await client.login()

    const calledUrl: string = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain('api=SYNO.API.Auth')
    expect(calledUrl).toContain('method=login')
    expect(calledUrl).toContain('account=admin')
    expect(calledUrl).toContain('session=DownloadStation')
  })
})
