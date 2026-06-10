const API_URL = 'https://api.myshows.me/v2/rpc/'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

interface JsonRpcResponse<T> {
  result: T
  error?: { message: string }
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const body: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method, params }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    throw new Error(`myshows.me API error: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as JsonRpcResponse<T>
  if (data.error) throw new Error(`myshows.me RPC error: ${data.error.message}`)
  return data.result
}

export interface MyShowsShow {
  id: number
  title: string
  titleOriginal?: string
  /** Poster image URL (may be absent for older API responses). */
  image?: string
  /** Show description (synopsis). */
  description?: string
}

export interface MyShowsEpisode {
  id: number
  title: string
  seasonNumber: number
  episodeNumber: number
  airDateUTC: string
}

export interface MyShowsShowDetailed extends MyShowsShow {
  episodes: MyShowsEpisode[]
}

/**
 * Minimal shape of a single show entry returned by the `shows.Search` RPC.
 *
 * VERIFIED (2026-06-10, live API): `shows.Search` returns an array of shows
 * under the `result` key, each with `id: number`, `title: string`, and the
 * optional `titleOriginal`/`image` strings, exactly as typed below.
 * See tests/live/myshows-search.live.test.ts (`LIVE_MYSHOWS=1 bun test tests/live/`).
 */
export interface MyShowsSearchResult {
  id: number
  title: string
  titleOriginal?: string
  image?: string
}

export async function getShowById(showId: number): Promise<MyShowsShowDetailed> {
  return rpc<MyShowsShowDetailed>('shows.GetById', { showId, withEpisodes: true })
}

/**
 * Searches the myshows.me catalog by name.
 *
 * Uses the `shows.Search` RPC method.
 *
 * VERIFIED (2026-06-10, live API): `shows.Search` accepts `{ query }` and
 * returns an array of `MyShowsSearchResult` objects directly as the RPC
 * result. `shows.GetById` episodes also carry the `seasonNumber` /
 * `episodeNumber` / `airDateUTC` fields that `getTodayEpisodes` relies on.
 * See tests/live/myshows-search.live.test.ts (skipped unless LIVE_MYSHOWS=1).
 */
export async function searchShows(query: string): Promise<MyShowsSearchResult[]> {
  const result = await rpc<MyShowsSearchResult[] | null>('shows.Search', { query })
  return result ?? []
}

/**
 * Returns episodes of the given show that air today (UTC date match).
 */
export async function getTodayEpisodes(
  showId: number
): Promise<Array<{ season: number; episode: number; title: string; airTime: string }>> {
  let show: MyShowsShowDetailed
  try {
    show = await getShowById(showId)
  } catch (err) {
    console.error(`[myshows] Failed to fetch show ${showId}:`, err)
    return []
  }

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  return show.episodes
    .filter((ep) => ep.airDateUTC && ep.airDateUTC.startsWith(today))
    .map((ep) => ({
      season: ep.seasonNumber,
      episode: ep.episodeNumber,
      title: ep.title,
      airTime: ep.airDateUTC,
    }))
}
