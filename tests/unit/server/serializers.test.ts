import { describe, it, expect } from 'bun:test'
import {
  serializeTask,
  serializeSearchResult,
  serializeSubscription,
  serializeShowSearchResult,
  serializeShowDetail,
  serializeCpu,
  serializeMemory,
  serializeVolumes,
  serializeDisks,
  serializeProcesses,
} from '../../../src/server/serializers.ts'
import type { Task } from '../../../src/infra/synology/types.ts'
import type { MyShowsSearchResult, MyShowsShowDetailed } from '../../../src/infra/myshows/client.ts'

describe('serializeTask', () => {
  it('derives pct, downloaded and speed from the transfer block', () => {
    const t: Task = {
      id: 't1',
      title: 'Movie',
      status: 'downloading',
      size: 200,
      additional: { detail: { destination: '/v1' }, transfer: { size_downloaded: 50, speed_download: 10 } },
    }
    expect(serializeTask(t)).toEqual({
      id: 't1', title: 'Movie', status: 'downloading',
      sizeBytes: 200, downloadedBytes: 50, speedBytesPerSec: 10, pct: 25, destination: '/v1',
    })
  })

  it('defaults missing transfer/destination to zero/null', () => {
    const t: Task = { id: 't1', title: 'X', status: 'waiting', size: 100 }
    expect(serializeTask(t)).toEqual({
      id: 't1', title: 'X', status: 'waiting',
      sizeBytes: 100, downloadedBytes: 0, speedBytesPerSec: 0, pct: 0, destination: null,
    })
  })

  it('reports pct 0 for a zero-size task (no division by zero)', () => {
    const t: Task = { id: 't1', title: 'X', status: 'waiting', size: 0, additional: { transfer: { size_downloaded: 0 } } }
    expect(serializeTask(t).pct).toBe(0)
  })

  it('caps pct at 100 when downloaded exceeds size', () => {
    const t: Task = { id: 't1', title: 'X', status: 'seeding', size: 100, additional: { transfer: { size_downloaded: 150 } } }
    expect(serializeTask(t).pct).toBe(100)
  })
})

describe('serializeSearchResult', () => {
  it('keeps downloadUrl (Toloka has no magnets)', () => {
    expect(
      serializeSearchResult({ id: '5', title: 'M', downloadUrl: 'https://toloka.to/download.php?id=5', size: '1 GB', seeders: 3, leechers: 1, category: 'Кино' })
    ).toEqual({ id: '5', title: 'M', size: '1 GB', seeders: 3, leechers: 1, downloadUrl: 'https://toloka.to/download.php?id=5', category: 'Кино' })
  })
})

describe('serializeSubscription', () => {
  it('nulls missing optional fields', () => {
    expect(serializeSubscription({ id: '1', showId: 1, title: 'S' })).toEqual({
      id: '1', showId: 1, title: 'S', lastNotifiedEpisode: null, poster: null, latestAiredEpisode: null,
    })
  })

  it('keeps lastNotifiedEpisode when present', () => {
    expect(serializeSubscription({ id: '1', showId: 1, title: 'S', lastNotifiedEpisode: { season: 2, episode: 4 } })).toEqual({
      id: '1', showId: 1, title: 'S', lastNotifiedEpisode: { season: 2, episode: 4 }, poster: null, latestAiredEpisode: null,
    })
  })

  it('includes poster and latestAiredEpisode when present', () => {
    expect(serializeSubscription({
      id: '1', showId: 1, title: 'S',
      poster: 'https://img.example.com/p.jpg',
      latestAiredEpisode: { season: 3, episode: 7, airDate: '2024-09-15T20:00:00Z' },
    })).toEqual({
      id: '1', showId: 1, title: 'S',
      lastNotifiedEpisode: null,
      poster: 'https://img.example.com/p.jpg',
      latestAiredEpisode: { season: 3, episode: 7, airDate: '2024-09-15T20:00:00Z' },
    })
  })
})

describe('serializeShowSearchResult', () => {
  const FIXTURE: MyShowsSearchResult = {
    id: 1396,
    title: 'Во все тяжкие',
    titleOriginal: 'Breaking Bad',
    image: 'https://myshows.me/img/1396.jpg',
  }

  it('maps basic fields', () => {
    const result = serializeShowSearchResult(FIXTURE, new Set())
    expect(result.id).toBe(1396)
    expect(result.title).toBe('Во все тяжкие')
    expect(result.titleOriginal).toBe('Breaking Bad')
    expect(result.poster).toBe('https://myshows.me/img/1396.jpg')
  })

  it('isSubscribed = false when not in subscribedIds', () => {
    expect(serializeShowSearchResult(FIXTURE, new Set()).isSubscribed).toBe(false)
  })

  it('isSubscribed = true when id is in subscribedIds', () => {
    expect(serializeShowSearchResult(FIXTURE, new Set([1396])).isSubscribed).toBe(true)
  })

  it('nulls absent optional fields', () => {
    const partial: MyShowsSearchResult = { id: 99, title: 'Some Show' }
    const result = serializeShowSearchResult(partial, new Set())
    expect(result.titleOriginal).toBeNull()
    expect(result.poster).toBeNull()
  })
})

describe('serializeShowDetail', () => {
  const NOW = new Date('2024-09-20T12:00:00Z')

  const FIXTURE: MyShowsShowDetailed = {
    id: 1396,
    title: 'Во все тяжкие',
    titleOriginal: 'Breaking Bad',
    image: 'https://myshows.me/img/1396.jpg',
    description: 'A chemistry teacher turned drug lord.',
    episodes: [
      { id: 1, title: 'Pilot', seasonNumber: 1, episodeNumber: 1, airDateUTC: '2008-01-20T02:00:00Z' },
      { id: 2, title: 'Cat\'s in the Bag', seasonNumber: 1, episodeNumber: 2, airDateUTC: '2008-01-27T02:00:00Z' },
      { id: 50, title: 'Ozymandias', seasonNumber: 5, episodeNumber: 14, airDateUTC: '2013-09-15T00:00:00Z' },
      { id: 60, title: 'Felina', seasonNumber: 5, episodeNumber: 16, airDateUTC: '2013-09-29T00:00:00Z' },
    ],
  }

  it('maps top-level fields', () => {
    const result = serializeShowDetail(FIXTURE, new Set(), NOW)
    expect(result.id).toBe(1396)
    expect(result.title).toBe('Во все тяжкие')
    expect(result.titleOriginal).toBe('Breaking Bad')
    expect(result.poster).toBe('https://myshows.me/img/1396.jpg')
    expect(result.description).toBe('A chemistry teacher turned drug lord.')
  })

  it('strips HTML markup from the description (myshows returns HTML)', () => {
    const htmlDesc: MyShowsShowDetailed = {
      ...FIXTURE,
      description: '<p>Британский сериал.</p> <h3>В чем суть?</h3> <p>Превосходные&nbsp;актеры &amp; сюжеты.</p>',
    }
    const result = serializeShowDetail(htmlDesc, new Set(), NOW)
    expect(result.description).not.toContain('<')
    expect(result.description).not.toContain('>')
    expect(result.description).toContain('Британский сериал.')
    expect(result.description).toContain('В чем суть?')
    expect(result.description).toContain('Превосходные актеры & сюжеты.')
  })

  it('isSubscribed reflects subscribedIds set', () => {
    expect(serializeShowDetail(FIXTURE, new Set(), NOW).isSubscribed).toBe(false)
    expect(serializeShowDetail(FIXTURE, new Set([1396]), NOW).isSubscribed).toBe(true)
  })

  it('groups episodes into seasons sorted ascending', () => {
    const result = serializeShowDetail(FIXTURE, new Set(), NOW)
    expect(result.seasons).toHaveLength(2)
    expect(result.seasons[0].season).toBe(1)
    expect(result.seasons[1].season).toBe(5)
  })

  it('marks past episodes as aired and future episodes as not aired', () => {
    // All fixture episodes are in the past relative to NOW (2024-09-20)
    const result = serializeShowDetail(FIXTURE, new Set(), NOW)
    for (const season of result.seasons) {
      for (const ep of season.episodes) {
        expect(ep.aired).toBe(true)
      }
    }
  })

  it('marks upcoming episodes as not aired', () => {
    const showWithFuture: MyShowsShowDetailed = {
      ...FIXTURE,
      episodes: [
        { id: 1, title: 'Ep 1', seasonNumber: 1, episodeNumber: 1, airDateUTC: '2024-09-15T00:00:00Z' }, // aired
        { id: 2, title: 'Ep 2', seasonNumber: 1, episodeNumber: 2, airDateUTC: '2025-01-01T00:00:00Z' }, // upcoming
      ],
    }
    const result = serializeShowDetail(showWithFuture, new Set(), NOW)
    const eps = result.seasons[0].episodes
    expect(eps[0].aired).toBe(true)
    expect(eps[1].aired).toBe(false)
  })

  it('nulls absent optional fields', () => {
    const minimal: MyShowsShowDetailed = { id: 99, title: 'X', episodes: [] }
    const result = serializeShowDetail(minimal, new Set(), NOW)
    expect(result.titleOriginal).toBeNull()
    expect(result.poster).toBeNull()
    expect(result.description).toBeNull()
    expect(result.seasons).toEqual([])
  })
})

describe('health serializers', () => {
  const util = { cpu: { user_load: 12, system_load: 5 }, memory: { real_usage: 40, total_real: 2000, avail_real: 800 } }

  it('serializeCpu maps load fields', () => {
    expect(serializeCpu(util)).toEqual({ userLoad: 12, systemLoad: 5 })
  })

  it('serializeMemory converts KB→bytes and derives used from real_usage', () => {
    expect(serializeMemory(util)).toEqual({ usedBytes: Math.round(2000 * 1024 * 0.4), totalBytes: 2000 * 1024, pct: 40 })
  })

  it('serializeVolumes derives pct from used/total', () => {
    expect(
      serializeVolumes({ volumes: [{ id: 'v1', vol_path: '/volume1', size: { total: '1000', used: '250' }, status: 'normal' }] })
    ).toEqual([{ path: '/volume1', usedBytes: 250, totalBytes: 1000, pct: 25, status: 'normal' }])
  })

  it('serializeDisks maps model/temp/status/smart', () => {
    expect(
      serializeDisks({ disks: [{ id: 'd1', model: 'WD', temp: 38, temperature_status: 'normal', status: 'normal', smart_status: 'normal' }] })
    ).toEqual([{ model: 'WD', tempC: 38, tempStatus: 'normal', status: 'normal', smart: 'normal' }])
  })

  it('serializeProcesses returns top-N by RAM and by CPU', () => {
    const slices = [
      { name: 'a', unit_name: 'a.slice', cpu_utilization: 1, memory: 300 },
      { name: 'b', unit_name: 'b.slice', cpu_utilization: 9, memory: 100 },
      { name: 'c', unit_name: 'c.slice', cpu_utilization: 5, memory: 200 },
    ]
    const out = serializeProcesses(slices, 2)
    expect(out.topRam).toEqual([{ name: 'a', bytes: 300 }, { name: 'c', bytes: 200 }])
    expect(out.topCpu).toEqual([{ name: 'b', pct: 9 }, { name: 'c', pct: 5 }])
  })
})
