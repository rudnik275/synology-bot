/**
 * Badge selector for the Shows tab list rows (ADR 0009).
 *
 * Pure function: given a Show's episodes and the current time, returns the
 * list-badge descriptor using the priority:
 *   1. Last episode that has already aired (most recent air date ≤ now)
 *   2. Nearest upcoming episode (smallest future air date)
 *   3. null — no dated episodes at all
 *
 * No I/O. Designed for isolated unit testing.
 */

export interface ShowEpisode {
  seasonNumber: number
  episodeNumber: number
  /** ISO date string, e.g. "2024-09-15T20:00:00Z". Empty string = no date. */
  airDateUTC: string
}

export interface ShowBadge {
  kind: 'aired' | 'upcoming'
  season: number
  episode: number
  airDate: string
}

export function selectShowBadge(episodes: ShowEpisode[], now: Date): ShowBadge | null {
  const nowMs = now.getTime()

  let lastAired: ShowBadge | null = null
  let nearest: ShowBadge | null = null

  for (const ep of episodes) {
    if (!ep.airDateUTC) continue

    const ms = new Date(ep.airDateUTC).getTime()
    if (isNaN(ms)) continue

    if (ms <= nowMs) {
      // Aired episode: keep the most recent one
      if (!lastAired || ms > new Date(lastAired.airDate).getTime()) {
        lastAired = {
          kind: 'aired',
          season: ep.seasonNumber,
          episode: ep.episodeNumber,
          airDate: ep.airDateUTC,
        }
      }
    } else {
      // Upcoming episode: keep the nearest one
      if (!nearest || ms < new Date(nearest.airDate).getTime()) {
        nearest = {
          kind: 'upcoming',
          season: ep.seasonNumber,
          episode: ep.episodeNumber,
          airDate: ep.airDateUTC,
        }
      }
    }
  }

  // Priority: last aired → nearest upcoming → null
  return lastAired ?? nearest
}
