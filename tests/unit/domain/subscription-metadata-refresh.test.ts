import { describe, it, expect } from 'bun:test'
import type { Subscription } from '../../../src/domain/subscription.ts'
import { refreshSubscriptionMetadata } from '../../../src/domain/subscription-metadata-refresh.ts'
import type { ShowForMetadata, ShowMetadataFetcher } from '../../../src/domain/subscription-metadata-refresh.ts'

const NOW = new Date('2024-09-20T12:00:00Z')

function sub(showId: number, overrides: Partial<Subscription> = {}): Subscription {
  return { id: String(showId), showId, title: `Show ${showId}`, ...overrides }
}

function show(poster?: string, episodes: ShowForMetadata['episodes'] = []): ShowForMetadata {
  return { poster, episodes }
}

describe('refreshSubscriptionMetadata', () => {
  it('returns an empty array for no subscriptions', async () => {
    const result = await refreshSubscriptionMetadata([], async () => show(), NOW)
    expect(result).toEqual([])
  })

  it('stamps poster from the fetcher result', async () => {
    const subs = [sub(1)]
    const fetcher: ShowMetadataFetcher = async () => show('https://img.example.com/poster.jpg')
    const result = await refreshSubscriptionMetadata(subs, fetcher, NOW)
    expect(result[0].poster).toBe('https://img.example.com/poster.jpg')
  })

  it('stamps latestAiredEpisode from the most recent aired episode', async () => {
    const subs = [sub(1)]
    const fetcher: ShowMetadataFetcher = async () =>
      show('url', [
        { seasonNumber: 2, episodeNumber: 5, airDateUTC: '2024-09-15T20:00:00Z' },
        { seasonNumber: 2, episodeNumber: 6, airDateUTC: '2025-01-01T20:00:00Z' }, // upcoming
      ])
    const result = await refreshSubscriptionMetadata(subs, fetcher, NOW)
    expect(result[0].latestAiredEpisode).toEqual({
      season: 2,
      episode: 5,
      airDate: '2024-09-15T20:00:00Z',
    })
  })

  it('does not overwrite latestAiredEpisode if badge is upcoming (no aired episode)', async () => {
    const existing = sub(1, {
      latestAiredEpisode: { season: 1, episode: 10, airDate: '2023-05-01T00:00:00Z' },
    })
    // All episodes are upcoming — no aired
    const fetcher: ShowMetadataFetcher = async () =>
      show('url', [{ seasonNumber: 2, episodeNumber: 1, airDateUTC: '2025-03-01T00:00:00Z' }])
    const result = await refreshSubscriptionMetadata([existing], fetcher, NOW)
    // Should keep old latestAiredEpisode since the fetched badge is 'upcoming'
    expect(result[0].latestAiredEpisode).toEqual({
      season: 1,
      episode: 10,
      airDate: '2023-05-01T00:00:00Z',
    })
  })

  it('refreshes ALL subscriptions, not only airing ones', async () => {
    const subs = [sub(1), sub(2), sub(3)]
    const fetched: number[] = []
    const fetcher: ShowMetadataFetcher = async (showId) => {
      fetched.push(showId)
      return show(`poster-${showId}`)
    }
    await refreshSubscriptionMetadata(subs, fetcher, NOW)
    expect(fetched.sort()).toEqual([1, 2, 3])
  })

  it('a fetch failure for one show does not poison others', async () => {
    const subs = [sub(1), sub(2), sub(3)]
    const fetcher: ShowMetadataFetcher = async (showId) => {
      if (showId === 2) throw new Error('myshows unavailable')
      return show(`poster-${showId}`)
    }
    const result = await refreshSubscriptionMetadata(subs, fetcher, NOW)
    expect(result).toHaveLength(3)
    expect(result[0].poster).toBe('poster-1')
    // show 2 failed — fallback to original sub (no poster)
    expect(result[1].poster).toBeUndefined()
    expect(result[2].poster).toBe('poster-3')
  })

  it('preserves existing poster when fetcher returns no poster', async () => {
    const existing = sub(1, { poster: 'https://old-poster.example.com/img.jpg' })
    const fetcher: ShowMetadataFetcher = async () => show(undefined) // no poster in response
    const result = await refreshSubscriptionMetadata([existing], fetcher, NOW)
    // Should keep old poster since new one is undefined
    expect(result[0].poster).toBe('https://old-poster.example.com/img.jpg')
  })

  it('does not mutate the original subscription objects', async () => {
    const original = sub(1)
    const fetcher: ShowMetadataFetcher = async () => show('new-poster')
    const result = await refreshSubscriptionMetadata([original], fetcher, NOW)
    expect(result[0]).not.toBe(original)
    expect(original.poster).toBeUndefined()
  })
})
