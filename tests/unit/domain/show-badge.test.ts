import { describe, it, expect } from 'bun:test'
import { selectShowBadge } from '../../../src/domain/show-badge.ts'
import type { ShowEpisode } from '../../../src/domain/show-badge.ts'

const NOW = new Date('2024-09-20T12:00:00Z')

function ep(season: number, episode: number, airDate: string): ShowEpisode {
  return { seasonNumber: season, episodeNumber: episode, airDateUTC: airDate }
}

describe('selectShowBadge — badge selector priority rules', () => {
  it('returns null for an empty episode list', () => {
    expect(selectShowBadge([], NOW)).toBeNull()
  })

  it('returns null when all episodes have no air date', () => {
    const episodes: ShowEpisode[] = [
      { seasonNumber: 1, episodeNumber: 1, airDateUTC: '' },
      { seasonNumber: 1, episodeNumber: 2, airDateUTC: '' },
    ]
    expect(selectShowBadge(episodes, NOW)).toBeNull()
  })

  it('returns the last aired episode for a mid-run show', () => {
    // NOW = 2024-09-20. Episodes up to S03E05 have aired; S03E06 is future.
    const episodes: ShowEpisode[] = [
      ep(3, 1, '2024-07-01T20:00:00Z'),
      ep(3, 2, '2024-07-08T20:00:00Z'),
      ep(3, 3, '2024-07-15T20:00:00Z'),
      ep(3, 4, '2024-07-22T20:00:00Z'),
      ep(3, 5, '2024-09-15T20:00:00Z'), // most recent aired
      ep(3, 6, '2024-09-27T20:00:00Z'), // upcoming
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge).not.toBeNull()
    expect(badge!.kind).toBe('aired')
    expect(badge!.season).toBe(3)
    expect(badge!.episode).toBe(5)
  })

  it('returns the last aired episode for a finished show (series finale)', () => {
    const episodes: ShowEpisode[] = [
      ep(1, 1, '2010-01-17T02:00:00Z'),
      ep(1, 2, '2010-01-17T03:00:00Z'),
      ep(5, 16, '2013-09-29T02:00:00Z'), // series finale — most recent
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge).not.toBeNull()
    expect(badge!.kind).toBe('aired')
    expect(badge!.season).toBe(5)
    expect(badge!.episode).toBe(16)
  })

  it('between seasons: last aired is prior finale, upcoming is next season premiere', () => {
    // S02 finale aired, S03 not yet started
    const episodes: ShowEpisode[] = [
      ep(2, 10, '2024-04-01T20:00:00Z'), // S02 finale — aired
      ep(3, 1, '2025-01-15T20:00:00Z'),  // S03 premiere — upcoming
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge).not.toBeNull()
    expect(badge!.kind).toBe('aired')
    expect(badge!.season).toBe(2)
    expect(badge!.episode).toBe(10)
  })

  it('not-yet-premiered: returns nearest upcoming episode when nothing has aired', () => {
    const episodes: ShowEpisode[] = [
      ep(1, 1, '2025-03-01T20:00:00Z'),
      ep(1, 2, '2025-03-08T20:00:00Z'),
      ep(1, 3, '2025-03-15T20:00:00Z'),
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge).not.toBeNull()
    expect(badge!.kind).toBe('upcoming')
    expect(badge!.season).toBe(1)
    expect(badge!.episode).toBe(1)
    expect(badge!.airDate).toBe('2025-03-01T20:00:00Z')
  })

  it('skips episodes with invalid air dates', () => {
    const episodes: ShowEpisode[] = [
      { seasonNumber: 1, episodeNumber: 1, airDateUTC: 'not-a-date' },
      ep(1, 2, '2024-09-15T20:00:00Z'), // valid, aired
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge).not.toBeNull()
    expect(badge!.kind).toBe('aired')
    expect(badge!.episode).toBe(2)
  })

  it('picks the most recent among multiple aired episodes', () => {
    const episodes: ShowEpisode[] = [
      ep(1, 1, '2024-01-01T00:00:00Z'),
      ep(1, 2, '2024-06-15T00:00:00Z'), // most recent aired
      ep(1, 3, '2025-01-01T00:00:00Z'), // upcoming
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge!.kind).toBe('aired')
    expect(badge!.episode).toBe(2)
  })

  it('picks the nearest among multiple upcoming episodes', () => {
    const episodes: ShowEpisode[] = [
      ep(1, 1, '2025-01-01T00:00:00Z'),
      ep(1, 2, '2025-02-01T00:00:00Z'),
      ep(1, 3, '2025-03-01T00:00:00Z'),
    ]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge!.kind).toBe('upcoming')
    expect(badge!.episode).toBe(1)
  })

  it('an episode aired exactly at now counts as aired', () => {
    const episodes: ShowEpisode[] = [ep(1, 1, '2024-09-20T12:00:00Z')]
    const badge = selectShowBadge(episodes, NOW)
    expect(badge!.kind).toBe('aired')
  })
})
