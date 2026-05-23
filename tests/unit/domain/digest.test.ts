import { describe, it, expect } from 'bun:test'
import type { Subscription, Episode } from '../../../src/domain/subscription.ts'
import { buildDigestMessage } from '../../../src/domain/digest.ts'

// Episode fetcher type: given showId → episodes airing "today"
type EpisodeFetcher = (showId: number) => Promise<Array<{ season: number; episode: number; title: string }>>

describe('buildDigestMessage — pure digest logic', () => {
  const noEpisodeFetcher: EpisodeFetcher = async () => []

  it('no subscriptions → returns null (no message)', async () => {
    const result = await buildDigestMessage([], noEpisodeFetcher)
    expect(result).toBeNull()
  })

  it('one subscription, no new episodes → returns null', async () => {
    const subs: Subscription[] = [{ id: 'show-1', showId: 1, title: 'Breaking Bad' }]
    const result = await buildDigestMessage(subs, noEpisodeFetcher)
    expect(result).toBeNull()
  })

  it('one subscription with new episode → returns digest message', async () => {
    const subs: Subscription[] = [{ id: 'show-1', showId: 1, title: 'Breaking Bad' }]
    const fetcher: EpisodeFetcher = async (showId) => {
      if (showId === 1) return [{ season: 5, episode: 14, title: 'Ozymandias' }]
      return []
    }
    const result = await buildDigestMessage(subs, fetcher)
    expect(result).not.toBeNull()
    expect(result).toContain('Breaking Bad')
    expect(result).toContain('S05E14')
  })

  it('two subscriptions both with new episodes → grouped message', async () => {
    const subs: Subscription[] = [
      { id: 'show-1', showId: 1, title: 'Breaking Bad' },
      { id: 'show-2', showId: 2, title: 'The Wire' },
    ]
    const fetcher: EpisodeFetcher = async (showId) => {
      if (showId === 1) return [{ season: 5, episode: 1, title: 'Ep1' }]
      if (showId === 2) return [{ season: 3, episode: 12, title: 'Ep2' }]
      return []
    }
    const result = await buildDigestMessage(subs, fetcher)
    expect(result).not.toBeNull()
    expect(result).toContain('Breaking Bad')
    expect(result).toContain('The Wire')
    expect(result).toContain('S05E01')
    expect(result).toContain('S03E12')
    // Should start with the header
    expect(result).toMatch(/^📺/)
  })

  it('two subscriptions, only one has new episode → only that one in message', async () => {
    const subs: Subscription[] = [
      { id: 'show-1', showId: 1, title: 'Breaking Bad' },
      { id: 'show-2', showId: 2, title: 'The Wire' },
    ]
    const fetcher: EpisodeFetcher = async (showId) => {
      if (showId === 2) return [{ season: 3, episode: 12, title: 'Ep2' }]
      return []
    }
    const result = await buildDigestMessage(subs, fetcher)
    expect(result).not.toBeNull()
    expect(result).not.toContain('Breaking Bad')
    expect(result).toContain('The Wire')
  })

  it('episode already notified (lastNotifiedEpisode matches) → skipped', async () => {
    const subs: Subscription[] = [
      {
        id: 'show-1',
        showId: 1,
        title: 'Breaking Bad',
        lastNotifiedEpisode: { season: 5, episode: 14 },
      },
    ]
    const fetcher: EpisodeFetcher = async (showId) => {
      if (showId === 1) return [{ season: 5, episode: 14, title: 'Ozymandias' }]
      return []
    }
    const result = await buildDigestMessage(subs, fetcher)
    expect(result).toBeNull()
  })

  it('episode after lastNotifiedEpisode → included in message', async () => {
    const subs: Subscription[] = [
      {
        id: 'show-1',
        showId: 1,
        title: 'Breaking Bad',
        lastNotifiedEpisode: { season: 5, episode: 13 },
      },
    ]
    const fetcher: EpisodeFetcher = async (showId) => {
      if (showId === 1) return [{ season: 5, episode: 14, title: 'Ozymandias' }]
      return []
    }
    const result = await buildDigestMessage(subs, fetcher)
    expect(result).not.toBeNull()
    expect(result).toContain('S05E14')
  })
})
