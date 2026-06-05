// TDD for deriveLastAired and deriveNextEpisode (issue #211).
// These are pure derivation functions exported from useShowDetail.ts.
// Tests are written BEFORE implementation (RED phase).

import { describe, it, expect } from 'bun:test'
import { deriveLastAired, deriveNextEpisode } from '../src/composables/useShowDetail'
import type { ShowSeasonView } from '../src/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEASONS_MIXED: ShowSeasonView[] = [
  {
    season: 1,
    episodes: [
      { episode: 1, title: 'Pilot', airDate: '2008-01-20T00:00:00Z', aired: true },
      { episode: 2, title: 'Ep 2',  airDate: '2008-01-27T00:00:00Z', aired: true },
    ],
  },
  {
    season: 2,
    episodes: [
      { episode: 1, title: 'S2E1', airDate: '2009-03-08T00:00:00Z', aired: true },
      { episode: 2, title: 'S2E2', airDate: '2025-12-01T00:00:00Z', aired: false },
      { episode: 3, title: 'S2E3', airDate: '2025-12-08T00:00:00Z', aired: false },
    ],
  },
]

const SEASONS_ALL_AIRED: ShowSeasonView[] = [
  {
    season: 1,
    episodes: [
      { episode: 1, title: 'Pilot', airDate: '2008-01-20T00:00:00Z', aired: true },
      { episode: 2, title: 'Ep 2',  airDate: '2008-01-27T00:00:00Z', aired: true },
    ],
  },
]

const SEASONS_UNAIRED_NO_DATE: ShowSeasonView[] = [
  {
    season: 1,
    episodes: [
      { episode: 1, title: 'Pilot', airDate: '2008-01-20T00:00:00Z', aired: true },
      { episode: 2, title: 'TBA',   airDate: null,                   aired: false },
    ],
  },
]

const SEASONS_EMPTY: ShowSeasonView[] = []

const SEASONS_MULTI_SEASON_NEXT: ShowSeasonView[] = [
  {
    season: 1,
    episodes: [
      { episode: 1, title: 'Pilot', airDate: '2008-01-20T00:00:00Z', aired: true },
    ],
  },
  {
    season: 2,
    episodes: [
      { episode: 1, title: 'S2E1',  airDate: '2026-01-15T00:00:00Z', aired: false },
    ],
  },
  {
    season: 3,
    episodes: [
      { episode: 1, title: 'S3E1',  airDate: '2026-06-01T00:00:00Z', aired: false },
    ],
  },
]

// ---------------------------------------------------------------------------
// deriveLastAired
// ---------------------------------------------------------------------------

describe('deriveLastAired', () => {
  it('returns latestAiredEpisode when provided (primary source)', () => {
    const lae = { season: 5, episode: 16, airDate: '2013-09-29T00:00:00Z' }
    const result = deriveLastAired(SEASONS_MIXED, lae)
    expect(result).toEqual(lae)
  })

  it('falls back to last aired===true episode when latestAiredEpisode is null', () => {
    // Last aired episode across all seasons is S2E1
    const result = deriveLastAired(SEASONS_MIXED, null)
    expect(result).toEqual({ season: 2, episode: 1, airDate: '2009-03-08T00:00:00Z' })
  })

  it('returns null when no aired episodes and latestAiredEpisode is null', () => {
    const seasonsNoneAired: ShowSeasonView[] = [
      {
        season: 1,
        episodes: [
          { episode: 1, title: 'TBA', airDate: null, aired: false },
        ],
      },
    ]
    const result = deriveLastAired(seasonsNoneAired, null)
    expect(result).toBeNull()
  })

  it('returns null when seasons is empty and latestAiredEpisode is null', () => {
    const result = deriveLastAired(SEASONS_EMPTY, null)
    expect(result).toBeNull()
  })

  it('prefers latestAiredEpisode even when seasons have more recent aired episodes', () => {
    // latestAiredEpisode is the authoritative server field; don't override it
    const lae = { season: 1, episode: 1, airDate: '2008-01-20T00:00:00Z' }
    const result = deriveLastAired(SEASONS_ALL_AIRED, lae)
    expect(result).toEqual(lae)
  })
})

// ---------------------------------------------------------------------------
// deriveNextEpisode
// ---------------------------------------------------------------------------

describe('deriveNextEpisode', () => {
  it('returns earliest aired===false episode with a non-null airDate', () => {
    // SEASONS_MIXED: S2E2 (2025-12-01) is the earliest upcoming
    const result = deriveNextEpisode(SEASONS_MIXED)
    expect(result).toEqual({ season: 2, episode: 2, airDate: '2025-12-01T00:00:00Z' })
  })

  it('returns null when all episodes are aired', () => {
    const result = deriveNextEpisode(SEASONS_ALL_AIRED)
    expect(result).toBeNull()
  })

  it('returns null when unaried episodes have no airDate', () => {
    const result = deriveNextEpisode(SEASONS_UNAIRED_NO_DATE)
    expect(result).toBeNull()
  })

  it('returns null for empty seasons', () => {
    const result = deriveNextEpisode(SEASONS_EMPTY)
    expect(result).toBeNull()
  })

  it('picks earliest across season boundaries', () => {
    // S2E1 (2026-01-15) is earlier than S3E1 (2026-06-01)
    const result = deriveNextEpisode(SEASONS_MULTI_SEASON_NEXT)
    expect(result).toEqual({ season: 2, episode: 1, airDate: '2026-01-15T00:00:00Z' })
  })

  it('skips aired===false episodes with null airDate when selecting earliest', () => {
    const seasons: ShowSeasonView[] = [
      {
        season: 1,
        episodes: [
          { episode: 1, title: 'TBA',  airDate: null,                   aired: false },
          { episode: 2, title: 'Next', airDate: '2026-03-01T00:00:00Z', aired: false },
        ],
      },
    ]
    const result = deriveNextEpisode(seasons)
    expect(result).toEqual({ season: 1, episode: 2, airDate: '2026-03-01T00:00:00Z' })
  })
})
