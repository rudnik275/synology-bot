import type { Subscription, Episode } from './subscription.ts'

export interface AiringEpisode {
  season: number
  episode: number
  title: string
}

export type EpisodeFetcher = (showId: number) => Promise<AiringEpisode[]>

/** Compare episodes: returns true if `ep` is strictly after `last` */
function isAfter(ep: AiringEpisode, last: Episode): boolean {
  if (ep.season !== last.season) return ep.season > last.season
  return ep.episode > last.episode
}

function isSame(ep: AiringEpisode, last: Episode): boolean {
  return ep.season === last.season && ep.episode === last.episode
}

function formatEp(ep: AiringEpisode): string {
  const s = String(ep.season).padStart(2, '0')
  const e = String(ep.episode).padStart(2, '0')
  return `S${s}E${e}`
}

/**
 * Pure function: given subscriptions + an episode fetcher, returns the
 * digest message to send, or null if nothing to report.
 *
 * The fetcher should return episodes airing "today" for the given showId.
 * Episodes already notified (matching lastNotifiedEpisode exactly, or older) are skipped.
 */
export async function buildDigestMessage(
  subscriptions: Subscription[],
  fetchTodayEpisodes: EpisodeFetcher
): Promise<string | null> {
  const lines: string[] = []

  for (const sub of subscriptions) {
    const episodes = await fetchTodayEpisodes(sub.showId)
    for (const ep of episodes) {
      const last = sub.lastNotifiedEpisode
      if (last && (isSame(ep, last) || !isAfter(ep, last))) {
        // Already notified or older — skip
        continue
      }
      lines.push(`• ${sub.title} — ${formatEp(ep)}`)
    }
  }

  if (lines.length === 0) return null

  return `📺 Сегодня:\n${lines.join('\n')}`
}
