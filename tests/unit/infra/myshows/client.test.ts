import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

// We test the module by intercepting globalThis.fetch.
// The myshows client is imported after setting up the mock.

const API_URL = 'https://api.myshows.me/v2/rpc/'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockFetch(responseBody: unknown, status = 200) {
  globalThis.fetch = (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

/** Captured myshows.Search response fixture (assumed shape — see ASSUMPTION caveat). */
const SEARCH_FIXTURE = {
  jsonrpc: '2.0',
  id: 1,
  result: [
    { id: 1396, title: 'Во все тяжкие', titleOriginal: 'Breaking Bad', image: 'https://myshows.me/img/1396.jpg' },
    { id: 1399, title: 'Игра престолов', titleOriginal: 'Game of Thrones', image: 'https://myshows.me/img/1399.jpg' },
  ],
}

/** Captured myshows.GetById response fixture with extended fields. */
const GET_BY_ID_FIXTURE = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    id: 1396,
    title: 'Во все тяжкие',
    titleOriginal: 'Breaking Bad',
    image: 'https://myshows.me/img/1396.jpg',
    description: 'A high school chemistry teacher turned methamphetamine manufacturer.',
    episodes: [
      { id: 1, title: 'Pilot', seasonNumber: 1, episodeNumber: 1, airDateUTC: '2008-01-20T02:00:00Z' },
      { id: 2, title: "Cat's in the Bag", seasonNumber: 1, episodeNumber: 2, airDateUTC: '2008-01-27T02:00:00Z' },
    ],
  },
}

describe('myshows client — searchShows', () => {
  it('calls shows.Search with the query param and returns results', async () => {
    let capturedBody: unknown
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return new Response(JSON.stringify(SEARCH_FIXTURE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const { searchShows } = await import('../../../../src/infra/myshows/client.ts')
    const results = await searchShows('Breaking Bad')

    expect(capturedBody).toMatchObject({ method: 'shows.Search', params: { query: 'Breaking Bad' } })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe(1396)
    expect(results[0].title).toBe('Во все тяжкие')
    expect(results[0].titleOriginal).toBe('Breaking Bad')
    expect(results[0].image).toBe('https://myshows.me/img/1396.jpg')
  })

  it('returns empty array when result is null', async () => {
    mockFetch({ jsonrpc: '2.0', id: 1, result: null })
    const { searchShows } = await import('../../../../src/infra/myshows/client.ts')
    const results = await searchShows('unknown')
    expect(results).toEqual([])
  })

  it('throws on RPC error', async () => {
    mockFetch({ jsonrpc: '2.0', id: 1, error: { message: 'invalid params' } })
    const { searchShows } = await import('../../../../src/infra/myshows/client.ts')
    await expect(searchShows('x')).rejects.toThrow('invalid params')
  })
})

describe('myshows client — getShowById (extended fields)', () => {
  it('returns poster and description from extended response', async () => {
    mockFetch(GET_BY_ID_FIXTURE)
    const { getShowById } = await import('../../../../src/infra/myshows/client.ts')
    const show = await getShowById(1396)

    expect(show.id).toBe(1396)
    expect(show.image).toBe('https://myshows.me/img/1396.jpg')
    expect(show.description).toBe('A high school chemistry teacher turned methamphetamine manufacturer.')
    expect(show.episodes).toHaveLength(2)
    expect(show.episodes[0].seasonNumber).toBe(1)
    expect(show.episodes[0].episodeNumber).toBe(1)
  })

  it('tolerates absent image and description fields', async () => {
    const fixture = {
      jsonrpc: '2.0',
      id: 1,
      result: { id: 99, title: 'Old Show', episodes: [] },
    }
    mockFetch(fixture)
    const { getShowById } = await import('../../../../src/infra/myshows/client.ts')
    const show = await getShowById(99)
    expect(show.image).toBeUndefined()
    expect(show.description).toBeUndefined()
  })
})
