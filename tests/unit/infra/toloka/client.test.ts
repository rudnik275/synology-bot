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
  const headers: Record<string, string> = {
    'Content-Type': 'text/html',
  }
  // Note: multiple Set-Cookie is tricky with Headers constructor
  // We'll use a custom approach via the Response init
  const resp = new Response(html, { status, headers })
  for (const cookie of setCookies) {
    resp.headers.append('set-cookie', cookie)
  }
  return resp
}

function makeBytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, {
    status,
    headers: { 'Content-Type': 'application/x-bittorrent' },
  })
}

const CONFIG = {
  username: 'testuser',
  password: 'testpass',
  baseUrl: BASE_URL,
}

describe('TolokaClient', () => {
  let store: PersistentStore
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    store = new PersistentStore(':memory:')
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(makeHtmlResponse('<html/>')))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    store.close()
  })

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  it('login() POSTs form-encoded credentials to /login.php', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        makeHtmlResponse('<html>ok</html>', 302, ['PHPSESSID=abc123; Path=/'])
      )
    )

    const client = new TolokaClient(CONFIG, store)
    await client.login()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/login.php`)
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('username=testuser')
    expect(String(init.body)).toContain('password=testpass')
    expect(String(init.body)).toContain('entry=login')
  })

  it('login() persists captured cookie to store under toloka.session.cookies key', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        makeHtmlResponse('<html>ok</html>', 302, [
          'PHPSESSID=sess123; Path=/',
          'bb_session=bb456; Path=/',
        ])
      )
    )

    const client = new TolokaClient(CONFIG, store)
    await client.login()

    const stored = store.getKv('toloka.session.cookies')
    expect(stored).toBeDefined()
    const parsed = JSON.parse(stored!)
    expect(parsed['PHPSESSID']).toBe('sess123')
    expect(parsed['bb_session']).toBe('bb456')
  })

  it('isLoggedIn() returns true when cookies are stored in PersistentStore', () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'existing' }))
    const client = new TolokaClient(CONFIG, store)
    expect(client.isLoggedIn()).toBe(true)
  })

  it('isLoggedIn() returns false when no cookies in store', () => {
    const client = new TolokaClient(CONFIG, store)
    expect(client.isLoggedIn()).toBe(false)
  })

  it('cookies persist across simulated restart (new client instance reads from store)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        makeHtmlResponse('<html>ok</html>', 302, ['PHPSESSID=persist123; Path=/'])
      )
    )

    const client1 = new TolokaClient(CONFIG, store)
    await client1.login()

    // Simulate restart: create new client with same store
    const client2 = new TolokaClient(CONFIG, store)
    expect(client2.isLoggedIn()).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Subsequent requests include Cookie header
  // -------------------------------------------------------------------------

  it('search() includes Cookie header in request', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'my-session' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-results.html')))
    )

    const client = new TolokaClient(CONFIG, store)
    await client.search('ubuntu')

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const cookieHeader = (init.headers as Record<string, string>)['Cookie']
    expect(cookieHeader).toContain('PHPSESSID=my-session')
  })

  // -------------------------------------------------------------------------
  // Auto re-login on auth failure
  // -------------------------------------------------------------------------

  it('search() re-logins and retries when response contains login form', async () => {
    let callCount = 0

    fetchMock.mockImplementation((url: string) => {
      callCount++

      if (callCount === 1) {
        // First search attempt returns login page (session expired)
        return Promise.resolve(makeHtmlResponse(readFixture('login.html')))
      }
      if (callCount === 2) {
        // Re-login POST
        return Promise.resolve(
          makeHtmlResponse('<html>ok</html>', 302, ['PHPSESSID=new-sess; Path=/'])
        )
      }
      // Retry: returns actual results
      return Promise.resolve(makeHtmlResponse(readFixture('search-results.html')))
    })

    const client = new TolokaClient(CONFIG, store)
    const results = await client.search('ubuntu')

    expect(callCount).toBe(3)
    expect(results.length).toBe(3)
  })

  it('search() throws after re-login if still getting login page', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('login.html'), 200, ['PHPSESSID=x; Path=/']))
    )

    const client = new TolokaClient(CONFIG, store)
    await expect(client.search('ubuntu')).rejects.toThrow('auth failed')
  })

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  it('search() returns parsed results from tracker.php response', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-results.html')))
    )

    const client = new TolokaClient(CONFIG, store)
    const results = await client.search('ubuntu')

    expect(results.length).toBe(3)
    expect(results[0]!.title).toBe('Ubuntu 24.04 LTS Desktop amd64')
    expect(results[0]!.seeders).toBe(1200)
  })

  it('search() passes URL-encoded query to tracker.php', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-empty.html')))
    )

    const client = new TolokaClient(CONFIG, store)
    await client.search('ubuntu 24.04')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('tracker.php')
    expect(url).toContain(encodeURIComponent('ubuntu 24.04'))
  })

  it('search() returns empty array for no-results page', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(makeHtmlResponse(readFixture('search-empty.html')))
    )

    const client = new TolokaClient(CONFIG, store)
    const results = await client.search('xyzabcdef')
    expect(results).toEqual([])
  })

  // -------------------------------------------------------------------------
  // downloadTorrent
  // -------------------------------------------------------------------------

  it('downloadTorrent() GETs URL with session cookie and returns Uint8Array', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'dl-sess' }))
    const fakeBytes = new Uint8Array([100, 101, 58, 49])

    fetchMock.mockImplementation(() => Promise.resolve(makeBytesResponse(fakeBytes)))

    const client = new TolokaClient(CONFIG, store)
    const result = await client.downloadTorrent(`${BASE_URL}/download.php?id=1001`)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result)).toEqual([100, 101, 58, 49])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/download.php?id=1001`)
    const cookieHeader = (init.headers as Record<string, string>)['Cookie']
    expect(cookieHeader).toContain('PHPSESSID=dl-sess')
  })

  it('downloadTorrent() throws on non-200 status', async () => {
    store.setKv('toloka.session.cookies', JSON.stringify({ PHPSESSID: 'sess' }))

    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('Not Found', { status: 404 }))
    )

    const client = new TolokaClient(CONFIG, store)
    await expect(
      client.downloadTorrent(`${BASE_URL}/download.php?id=9999`)
    ).rejects.toThrow('404')
  })

  // -------------------------------------------------------------------------
  // getDownloadUrl
  // -------------------------------------------------------------------------

  it('getDownloadUrl() returns correct URL for given topic ID', () => {
    const client = new TolokaClient(CONFIG, store)
    expect(client.getDownloadUrl('1234')).toBe(`${BASE_URL}/download.php?id=1234`)
  })
})
