/**
 * LIVE verification test for the myshows.me JSON-RPC API.
 *
 * Skipped by default so the unit suite never hits the network.
 * Run manually with:
 *
 *   LIVE_MYSHOWS=1 bun test tests/live/
 *
 * Verifies the assumed response shapes of `shows.Search` (searchShows) and
 * `shows.GetById` (used by getTodayEpisodes). See src/infra/myshows/client.ts.
 */
import { describe, expect, test } from 'bun:test'
import { getShowById, searchShows } from '../../src/infra/myshows/client'

const live = !!process.env.LIVE_MYSHOWS

describe.skipIf(!live)('myshows.me live API', () => {
  test(
    'shows.Search returns the fields the app consumes',
    async () => {
      const results = await searchShows('Breaking Bad')

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBeGreaterThan(0)

      for (const show of results) {
        expect(typeof show.id).toBe('number')
        expect(typeof show.title).toBe('string')
        expect(show.title.length).toBeGreaterThan(0)
        if (show.titleOriginal !== undefined) {
          expect(typeof show.titleOriginal).toBe('string')
        }
        if (show.image !== undefined) {
          expect(typeof show.image).toBe('string')
        }
      }

      // At least the top hit should carry the optional presentation fields
      // the mini-app displays (original title + poster image).
      const breakingBad = results.find(
        (s) => s.titleOriginal === 'Breaking Bad' || s.title === 'Breaking Bad'
      )
      expect(breakingBad).toBeDefined()
      expect(typeof breakingBad!.titleOriginal).toBe('string')
      expect(typeof breakingBad!.image).toBe('string')
    },
    60000
  )

  test(
    'shows.GetById exposes the episode fields getTodayEpisodes assumes',
    async () => {
      const results = await searchShows('Breaking Bad')
      expect(results.length).toBeGreaterThan(0)

      const show = await getShowById(results[0]!.id)

      expect(typeof show.id).toBe('number')
      expect(typeof show.title).toBe('string')
      expect(Array.isArray(show.episodes)).toBe(true)
      expect(show.episodes.length).toBeGreaterThan(0)

      for (const ep of show.episodes) {
        expect(typeof ep.seasonNumber).toBe('number')
        expect(typeof ep.episodeNumber).toBe('number')
        // airDateUTC must be a YYYY-MM-DD-prefixed string for the
        // startsWith(today) filter in getTodayEpisodes to work.
        expect(typeof ep.airDateUTC).toBe('string')
      }
      const dated = show.episodes.filter((ep) => ep.airDateUTC)
      expect(dated.length).toBeGreaterThan(0)
      for (const ep of dated) {
        expect(ep.airDateUTC).toMatch(/^\d{4}-\d{2}-\d{2}/)
      }
    },
    60000
  )
})
