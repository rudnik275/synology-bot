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

export async function getShowById(showId: number): Promise<MyShowsShowDetailed> {
  return rpc<MyShowsShowDetailed>('shows.GetById', { showId, withEpisodes: true })
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
