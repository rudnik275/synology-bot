import { describe, it, expect } from 'bun:test'
import {
  buildDigestMessage,
  filterNewEpisodes,
  latestEpisode,
  type AiringEpisode,
} from '../../../src/domain/digest.ts'

describe('filterNewEpisodes — pure filtering', () => {
  const ozymandias: AiringEpisode = { season: 5, episode: 14, title: 'Ozymandias' }

  it('no lastNotifiedEpisode → all episodes pass through', () => {
    expect(filterNewEpisodes([ozymandias], undefined)).toEqual([ozymandias])
  })

  it('episode matches lastNotifiedEpisode exactly → dropped', () => {
    expect(filterNewEpisodes([ozymandias], { season: 5, episode: 14 })).toEqual([])
  })

  it('episode older than lastNotifiedEpisode → dropped', () => {
    expect(filterNewEpisodes([ozymandias], { season: 5, episode: 15 })).toEqual([])
    expect(filterNewEpisodes([ozymandias], { season: 6, episode: 1 })).toEqual([])
  })

  it('episode after lastNotifiedEpisode → kept', () => {
    expect(filterNewEpisodes([ozymandias], { season: 5, episode: 13 })).toEqual([ozymandias])
    expect(filterNewEpisodes([ozymandias], { season: 4, episode: 16 })).toEqual([ozymandias])
  })
})

describe('latestEpisode — pick the highest season/episode', () => {
  it('picks the latest across seasons and episodes', () => {
    const eps: AiringEpisode[] = [
      { season: 2, episode: 3, title: 'b' },
      { season: 3, episode: 1, title: 'c' },
      { season: 2, episode: 9, title: 'a' },
    ]
    expect(latestEpisode(eps)).toEqual({ season: 3, episode: 1, title: 'c' })
  })
})

describe('buildDigestMessage — pure digest formatting', () => {
  it('no entries → returns null (no message)', () => {
    expect(buildDigestMessage([])).toBeNull()
  })

  it('entries with no episodes → returns null', () => {
    expect(buildDigestMessage([{ title: 'Breaking Bad', episodes: [] }])).toBeNull()
  })

  it('one entry with episode → returns digest message', () => {
    const result = buildDigestMessage([
      { title: 'Breaking Bad', episodes: [{ season: 5, episode: 14, title: 'Ozymandias' }] },
    ])
    expect(result).not.toBeNull()
    expect(result).toContain('Breaking Bad')
    expect(result).toContain('S05E14')
  })

  it('two entries → grouped message with header', () => {
    const result = buildDigestMessage([
      { title: 'Breaking Bad', episodes: [{ season: 5, episode: 1, title: 'Ep1' }] },
      { title: 'The Wire', episodes: [{ season: 3, episode: 12, title: 'Ep2' }] },
    ])
    expect(result).not.toBeNull()
    expect(result).toContain('Breaking Bad')
    expect(result).toContain('The Wire')
    expect(result).toContain('S05E01')
    expect(result).toContain('S03E12')
    expect(result).toMatch(/^📺/)
  })

  it('one entry with two episodes → one line per episode', () => {
    const result = buildDigestMessage([
      {
        title: 'The Wire',
        episodes: [
          { season: 3, episode: 11, title: 'Ep11' },
          { season: 3, episode: 12, title: 'Ep12' },
        ],
      },
    ])
    expect(result).toContain('S03E11')
    expect(result).toContain('S03E12')
  })
})
