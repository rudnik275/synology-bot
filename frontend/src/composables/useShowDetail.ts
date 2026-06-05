import { ref } from 'vue'
import { api } from '../api'
import type { ShowDetailView, ShowSeasonView, SubscriptionView } from '../types'

// ---------------------------------------------------------------------------
// Pure derivation helpers (exported for unit testing — issue #211)
// ---------------------------------------------------------------------------

/** Result shape shared by both derivation helpers. */
export interface EpisodeRef {
  season: number
  episode: number
  airDate: string
}

/**
 * Derive the last-aired episode.
 *
 * Priority:
 * 1. `latestAiredEpisode` from the subscription (authoritative server field).
 * 2. Fallback: last episode across all seasons where `aired === true`.
 * 3. null if neither is available.
 */
export function deriveLastAired(
  seasons: ShowSeasonView[],
  latestAiredEpisode: SubscriptionView['latestAiredEpisode'],
): EpisodeRef | null {
  if (latestAiredEpisode !== null && latestAiredEpisode !== undefined) {
    return {
      season: latestAiredEpisode.season,
      episode: latestAiredEpisode.episode,
      airDate: latestAiredEpisode.airDate,
    }
  }

  // Fallback: walk seasons in order, collect aired episodes, return last.
  let last: EpisodeRef | null = null
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (ep.aired && ep.airDate !== null) {
        last = { season: s.season, episode: ep.episode, airDate: ep.airDate }
      }
    }
  }
  return last
}

/**
 * Derive the next (upcoming) episode.
 *
 * Returns the earliest episode where `aired === false && airDate != null`,
 * comparing by ISO date string (lexicographic ≡ chronological for ISO-8601).
 * Returns null if no such episode exists.
 */
export function deriveNextEpisode(seasons: ShowSeasonView[]): EpisodeRef | null {
  let next: EpisodeRef | null = null
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (!ep.aired && ep.airDate !== null) {
        const candidate: EpisodeRef = { season: s.season, episode: ep.episode, airDate: ep.airDate }
        if (next === null || ep.airDate < next.airDate) {
          next = candidate
        }
      }
    }
  }
  return next
}

/**
 * Composable for fetching the detail view of a Show (ADR 0009).
 * Fetches /api/shows/:id; the endpoint also performs the self-heal write.
 */
export function useShowDetail() {
  const data = ref<ShowDetailView | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(showId: number): Promise<void> {
    loading.value = true
    error.value = null
    data.value = null
    try {
      data.value = await api.getShow(showId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function clear(): void {
    data.value = null
    error.value = null
    loading.value = false
  }

  return { data, loading, error, load, clear }
}
