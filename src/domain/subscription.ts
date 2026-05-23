export interface Episode {
  season: number
  episode: number
}

export interface Subscription {
  /** Unique identifier (string form of showId or UUID) */
  id: string
  /** myshows.me show id */
  showId: number
  title: string
  lastNotifiedEpisode?: Episode
}
