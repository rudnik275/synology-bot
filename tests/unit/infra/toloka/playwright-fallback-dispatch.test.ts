/**
 * Dispatch logic tests for the Playwright fallback in TolokaClient.
 *
 * These tests focus on WHEN the fallback is triggered (or not), using:
 * - mocked HTTP responses (via globalThis.fetch)
 * - injected fake fallback function (no real Playwright / Chromium in CI)
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { TolokaClient } from '../../../../src/infra/toloka/client.ts'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURES_DIR = join(import.meta.dir, '../../../fixtures/toloka')
const BASE_URL = 'https://toloka.to'

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

function makeHtmlResponse(html: string, status = 200, setCookies: string[] = []): Response {
  const resp = new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })
  for (const cookie of setCookies) {
    resp.headers.append('set-cookie', cookie)
  }
  return resp
}

const CONFIG = {
  username: 'testuser',
  password: 'testpass',
  baseUrl: BASE_URL,
  playwrightEnabled: true,
}

const FAKE_RESULTS = [
  {
    id: '9001',
    title: 'Playwright Result',
    downloadUrl: `${BASE_URL}/download.php?id=9001`,
    size: '1.0 GB',
    seeders: 50,
    leechers: 5,
    category: 'Фільми',
  },
]

describe('TolokaClient Playwright fallback dispatch', () => {
  let store: PersistentStore
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof mock>
  let fakeFallback: ReturnType<typeof mock>

  beforeEach(() => {
    store = new PersistentStore(':memory:')
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(makeHtmlResponse('<html/>')))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    fakeFallback = mock(() =>
      Promise.resolve({ results: FAKE_RESULTS, newCookie: 'PHPSESSID=playwright-cookie' })
    )
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    store.close()
  })

  // ---------------------------------------------------------------------------
  // HTTP succeeds → fallback NOT called
  // ---------------------------------------------------------------------------

  it('does NOT call fallback when HTTP search succeeds with valid results', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-results.html')))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).not.toHaveBeenCalled()
    expect(results.length).toBe(3)
  })

  it('does NOT call fallback when HTTP returns legitimate empty results (clean body)', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-empty.html')))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('xyznotfound')

    expect(fakeFallback).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // HTTP returns Cloudflare interstitial → fallback called
  // ---------------------------------------------------------------------------

  it('calls fallback when HTTP returns Cloudflare interstitial HTML (cf-browser-verification)', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('cloudflare-interstitial.html')))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).toHaveBeenCalledTimes(1)
    expect(results).toEqual(FAKE_RESULTS)
  })

  it('calls fallback when HTTP returns "Just a moment..." interstitial body', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    const interstitialHtml = '<html><head><title>Just a moment...</title></head><body>checking your browser</body></html>'
    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(interstitialHtml))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).toHaveBeenCalledTimes(1)
    expect(results).toEqual(FAKE_RESULTS)
  })

  // ---------------------------------------------------------------------------
  // HTTP returns 403 → fallback called
  // ---------------------------------------------------------------------------

  it('calls fallback when HTTP returns 403 status', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse('Forbidden', 403))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).toHaveBeenCalledTimes(1)
    expect(results).toEqual(FAKE_RESULTS)
  })

  // ---------------------------------------------------------------------------
  // HTTP returns 503 → fallback called
  // ---------------------------------------------------------------------------

  it('calls fallback when HTTP returns 503 status', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse('Service Unavailable', 503))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).toHaveBeenCalledTimes(1)
    expect(results).toEqual(FAKE_RESULTS)
  })

  // ---------------------------------------------------------------------------
  // HTTP 0 results + suspicious body → fallback called
  // ---------------------------------------------------------------------------

  it('calls fallback when HTTP returns 0 results and body has challenge marker', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    const suspiciousHtml = '<html><body><p>checking your browser</p></body></html>'
    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(suspiciousHtml))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    const results = await client.search('ubuntu')

    expect(fakeFallback).toHaveBeenCalledTimes(1)
    expect(results).toEqual(FAKE_RESULTS)
  })

  // ---------------------------------------------------------------------------
  // HTTP returns login page → fallback NOT called (credentials issue)
  // ---------------------------------------------------------------------------

  it('does NOT call fallback when HTTP returns login page (auth/credentials error)', async () => {
    // Returns login page on every call (no valid cookie in store to trigger re-login path)
    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('login.html'), 200, ['PHPSESSID=x; Path=/']))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)

    await expect(client.search('ubuntu')).rejects.toThrow('auth failed')
    expect(fakeFallback).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // playwrightEnabled=false → fallback NOT called
  // ---------------------------------------------------------------------------

  it('does NOT call fallback when playwrightEnabled=false even on Cloudflare-style failure', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('cloudflare-interstitial.html')))
    )

    const client = new TolokaClient(
      { ...CONFIG, playwrightEnabled: false },
      store,
      fakeFallback as any
    )

    await expect(client.search('ubuntu')).rejects.toThrow(/bot.detection|cloudflare|interstitial|blocked/i)
    expect(fakeFallback).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // After fallback used → next search goes HTTP first again (not sticky)
  // ---------------------------------------------------------------------------

  it('goes HTTP-first on the next search after fallback was used (not sticky)', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    let callIndex = 0
    fetchMock.mockImplementation(() => {
      callIndex++
      if (callIndex === 1) {
        // First search: Cloudflare block → triggers fallback
        return Promise.resolve(makeHtmlResponse(readFixture('cloudflare-interstitial.html')))
      }
      // Second search: HTTP works fine
      return Promise.resolve(makeHtmlResponse(readFixture('search-results.html')))
    })

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)

    // First search uses fallback
    await client.search('ubuntu')
    expect(fakeFallback).toHaveBeenCalledTimes(1)

    // Second search: HTTP works → fallback not called again
    const results2 = await client.search('debian')
    expect(fakeFallback).toHaveBeenCalledTimes(1) // still 1, not 2
    expect(results2.length).toBe(3)
  })

  // ---------------------------------------------------------------------------
  // Fallback throws → error propagated to caller
  // ---------------------------------------------------------------------------

  it('propagates fallback error to caller when fallback itself throws', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse('Forbidden', 403))
    )

    fakeFallback.mockImplementation(() =>
      Promise.reject(new Error('Playwright: browser launch failed'))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)

    await expect(client.search('ubuntu')).rejects.toThrow('Playwright: browser launch failed')
  })

  // ---------------------------------------------------------------------------
  // Fallback persists returned cookies back to store
  // ---------------------------------------------------------------------------

  it('persists cookies returned by fallback back into the session store', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'old-sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse('Forbidden', 403))
    )

    fakeFallback.mockImplementation(() =>
      Promise.resolve({ results: FAKE_RESULTS, newCookie: 'PHPSESSID=fresh-cookie; bb_session=bb123' })
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    await client.search('ubuntu')

    const stored = store.getKv('toloka.session.cookies')
    expect(stored).toBeDefined()
    const parsed = JSON.parse(stored!)
    expect(parsed['PHPSESSID']).toBe('fresh-cookie')
  })

  // ---------------------------------------------------------------------------
  // Fallback is invoked with existing cookie for session reuse
  // ---------------------------------------------------------------------------

  it('passes existing session cookie to fallback for session reuse', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'old-sess', bb_session: 'bb' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse('Forbidden', 403))
    )

    const client = new TolokaClient(CONFIG, store, fakeFallback as any)
    await client.search('ubuntu')

    const [_query, opts] = fakeFallback.mock.calls[0] as [string, { cookie?: string }]
    expect(opts.cookie).toContain('PHPSESSID=old-sess')
  })
})

// ---------------------------------------------------------------------------
// Fallback parsing layer integration test
// (exercises parseSearchPage with a Playwright-shaped HTML response)
// ---------------------------------------------------------------------------
describe('Playwright fallback: parsing layer integration', () => {
  it('parseSearchPage correctly parses the search-results fixture (Playwright HTML shape)', () => {
    // Simulates what playwrightFallback would feed into parseSearchPage:
    // page.content() → same HTML structure the HTTP path would return.
    const html = readFileSync(join(FIXTURES_DIR, 'search-results.html'), 'utf-8')
    // We import parseSearchPage directly to test the parsing layer in isolation.
    const { parseSearchPage } = require('../../../../src/infra/toloka/parser.ts')
    const results = parseSearchPage(html, BASE_URL)

    expect(results.length).toBe(3)
    expect(results[0].title).toBe('Ubuntu 24.04 LTS Desktop amd64')
    expect(results[0].seeders).toBe(1200)
    expect(results[0].downloadUrl).toContain('/download.php?id=1001')
  })
})
