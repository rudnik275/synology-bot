import { describe, it, expect } from 'bun:test'
import {
  serializeTask,
  serializeSearchResult,
  serializeSubscription,
  serializeCpu,
  serializeMemory,
  serializeVolumes,
  serializeDisks,
  serializeProcesses,
} from '../../../src/server/serializers.ts'
import type { Task } from '../../../src/infra/synology/types.ts'

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
  it('nulls a missing lastNotifiedEpisode', () => {
    expect(serializeSubscription({ id: '1', showId: 1, title: 'S' })).toEqual({
      id: '1', showId: 1, title: 'S', lastNotifiedEpisode: null,
    })
  })

  it('keeps lastNotifiedEpisode when present', () => {
    expect(serializeSubscription({ id: '1', showId: 1, title: 'S', lastNotifiedEpisode: { season: 2, episode: 4 } })).toEqual({
      id: '1', showId: 1, title: 'S', lastNotifiedEpisode: { season: 2, episode: 4 },
    })
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
