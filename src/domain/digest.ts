import type { Episode } from './subscription.ts'

export interface AiringEpisode {
  season: number
  episode: number
  title: string
}

export type EpisodeFetcher = (showId: number) => Promise<AiringEpisode[]>

/** A subscription's contribution to the digest: its title + the new episodes to announce. */
export interface DigestEntry {
  title: string
  episodes: AiringEpisode[]
}

/** Compare episodes: returns true if `ep` is strictly after `last` */
function isAfter(ep: AiringEpisode, last: Episode): boolean {
  if (ep.season !== last.season) return ep.season > last.season
  return ep.episode > last.episode
}

function formatEp(ep: AiringEpisode): string {
  const s = String(ep.season).padStart(2, '0')
  const e = String(ep.episode).padStart(2, '0')
  return `S${s}E${e}`
}

/**
 * Filter the fetched episodes down to the ones not yet notified.
 * Episodes matching `last` exactly, or older, are dropped.
 */
export function filterNewEpisodes(
  episodes: AiringEpisode[],
  last: Episode | undefined
): AiringEpisode[] {
  if (!last) return [...episodes]
  return episodes.filter((ep) => isAfter(ep, last))
}

/** Pick the latest episode (highest season/episode) from a non-empty list. */
export function latestEpisode(episodes: AiringEpisode[]): AiringEpisode {
  return episodes.reduce((best, ep) => {
    if (ep.season > best.season) return ep
    if (ep.season === best.season && ep.episode > best.episode) return ep
    return best
  })
}

/**
 * Pure formatter: given pre-fetched, pre-filtered digest entries, returns the
 * digest message to send, or null if nothing to report.
 *
 * Fetching/filtering happens exactly once in runDigest (digest-scheduler.ts),
 * so the message and the lastNotifiedEpisode advance derive from the same
 * snapshot (#289).
 */
export function buildDigestMessage(entries: DigestEntry[]): string | null {
  const lines = entries.flatMap((entry) =>
    entry.episodes.map((ep) => `• ${entry.title} — ${formatEp(ep)}`)
  )

  if (lines.length === 0) return null

  return `📺 Сегодня:\n${lines.join('\n')}`
}
