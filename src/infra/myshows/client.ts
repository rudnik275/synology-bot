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
 * ASSUMPTION: The `shows.Search` method returns a list of shows under the
 * `result` key, each with at least `id`, `title`, `titleOriginal`, and
 * `image`. This shape is inferred from the existing `shows.GetById` pattern
 * and the public myshows.me API documentation.
 *
 * ⚠️ NEEDS LIVE-API VERIFICATION — the exact field names and response wrapper
 * must be confirmed against the live myshows.me JSON-RPC API. See PR caveat.
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
 * ⚠️ ASSUMPTION: The exact request/response shape of `shows.Search` has been
 * inferred from the existing `shows.GetById` pattern and is assumed to accept
 * `{ query }` and return an array of `MyShowsSearchResult` objects directly as
 * the RPC result. This MUST be verified against the live API.
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
