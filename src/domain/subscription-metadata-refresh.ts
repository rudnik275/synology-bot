/**
 * Subscription metadata refresh (ADR 0009).
 *
 * Given the current subscriptions, a Show fetcher (injected), and the current
 * time, returns a new array of subscriptions with `poster` and
 * `latestAiredEpisode` stamped from the live myshows data.
 *
 * Designed after the `buildDigestMessage` pattern: pure async function with
 * injected deps, no I/O of its own. One show's fetch failure must NOT poison
 * the others — failed shows keep their existing cached values.
 *
 * Called from:
 *  - The daily digest (which already fetches each show's full episode list)
 *  - The detail-page self-heal path (called on a single show)
 */

import type { Subscription } from './subscription.ts'
import type { ShowEpisode } from './show-badge.ts'
import { selectShowBadge } from './show-badge.ts'

/** Minimal shape of a Show the fetcher must return. */
export interface ShowForMetadata {
  poster?: string
  episodes: ShowEpisode[]
}

/** Injected fetcher type — returns the show data or throws. */
export type ShowMetadataFetcher = (showId: number) => Promise<ShowForMetadata>

/**
 * Refreshes metadata (poster + latestAiredEpisode) for all subscriptions.
 *
 * Returns a new array; original subscription objects are not mutated.
 * A fetch failure for one show keeps its existing cached values.
 */
export async function refreshSubscriptionMetadata(
  subscriptions: Subscription[],
  fetcher: ShowMetadataFetcher,
  now: Date
): Promise<Subscription[]> {
  const results: Subscription[] = []

  for (const sub of subscriptions) {
    try {
      const show = await fetcher(sub.showId)
      const badge = selectShowBadge(show.episodes, now)

      const updated: Subscription = {
        ...sub,
        poster: show.poster ?? sub.poster,
        latestAiredEpisode:
          badge?.kind === 'aired'
            ? { season: badge.season, episode: badge.episode, airDate: badge.airDate }
            : sub.latestAiredEpisode,
      }
      results.push(updated)
    } catch (err) {
      // One show's failure must not poison others — keep existing cached values.
      console.error(`[metadata-refresh] Failed to fetch show ${sub.showId}:`, err)
      results.push(sub)
    }
  }

  return results
}
