export interface Episode {
  season: number
  episode: number
}

export interface LatestAiredEpisode {
  season: number
  episode: number
  airDate: string
}

export interface Subscription {
  /** Unique identifier (string form of showId or UUID) */
  id: string
  /** myshows.me show id */
  showId: number
  title: string
  lastNotifiedEpisode?: Episode
  /**
   * Cached poster URL. Stamped by the daily refresh and self-healed on detail open.
   * Pre-existing subscriptions lack this field until backfilled; readers must tolerate absence.
   */
  poster?: string
  /**
   * Cached latest-aired episode, derived from real air dates (not notification state).
   * Stamped by the daily refresh and self-healed on detail open.
   * Pre-existing subscriptions lack this field until backfilled; readers must tolerate absence.
   */
  latestAiredEpisode?: LatestAiredEpisode
}
