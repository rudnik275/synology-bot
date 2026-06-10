import { describe, it, expect, beforeEach } from 'bun:test'
import { DiskUsageWatcher } from '../../../src/domain/disk-usage-watcher.ts'
import type { DiskUsageWatcherDeps } from '../../../src/domain/disk-usage-watcher.ts'
import type { StorageInfo } from '../../../src/infra/synology/types.ts'

// ---- Helpers ----

function makeVolume(id: string, vol_path: string, usedPct: number): StorageInfo['volumes'][number] {
  const total = 1_000_000_000_000 // 1 TB in bytes (as number)
  const used = Math.round(total * usedPct / 100)
  return {
    id,
    vol_path,
    size: {
      total: String(total),
      used: String(used),
    },
    status: 'normal',
  }
}

interface TestHarness {
  watcher: DiskUsageWatcher
  notifications: Array<string>
  warned: Set<string>
  getStorageResult: { ok: true; data: StorageInfo } | { ok: false; reason: string }
}

function makeHarness(
  initialWarned: string[] = [],
  highPct = 90,
  lowPct = 85
): TestHarness {
  const notifications: Array<string> = []
  const warned = new Set<string>(initialWarned)

  const deps: DiskUsageWatcherDeps = {
    getStorageInfo: async () => harness.getStorageResult,
    isVolumeWarned: async (volumeId) => warned.has(volumeId),
    markWarned: async (volumeId) => { warned.add(volumeId) },
    clearWarned: async (volumeId) => { warned.delete(volumeId) },
    notify: async (msg) => { notifications.push(msg) },
    highPct,
    lowPct,
  }

  const watcher = new DiskUsageWatcher(deps)

  const harness: TestHarness = {
    watcher,
    notifications,
    warned,
    getStorageResult: { ok: true, data: { volumes: [] } },
  }

  return harness
}

// ---- Tests ----

describe('DiskUsageWatcher', () => {
  it('volume in ok, usage 80% → no notification, stays ok', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 80)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(0)
    expect(h.warned.has('volume_1')).toBe(false)
  })

  it('volume in ok, usage 85% → no notification (in hysteresis band, starts ok)', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 85)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(0)
    expect(h.warned.has('volume_1')).toBe(false)
  })

  it('volume in ok, usage 90% → warning fired once, state → warn', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 90)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toContain('Volume 1')
    expect(h.notifications[0]).toContain('⚠️')
    expect(h.warned.has('volume_1')).toBe(true)
  })

  it('volume in warn, usage 89% → no notification (hysteresis band, stays warn)', async () => {
    const h = makeHarness(['volume_1'])
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 89)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(0)
    expect(h.warned.has('volume_1')).toBe(true)
  })

  it('volume in warn, usage 85% → no notification (boundary — must be < 85 to clear)', async () => {
    const h = makeHarness(['volume_1'])
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 85)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(0)
    expect(h.warned.has('volume_1')).toBe(true)
  })

  it('volume in warn, usage 84% → recovery fired once, state → ok', async () => {
    const h = makeHarness(['volume_1'])
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 84)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toContain('Volume 1')
    expect(h.notifications[0]).toContain('✅')
    expect(h.warned.has('volume_1')).toBe(false)
  })

  it('two volumes simultaneously crossing threshold → both fire independently', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: {
        volumes: [
          makeVolume('volume_1', 'Volume 1', 92),
          makeVolume('volume_2', 'Volume 2', 95),
        ],
      },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(2)
    const msgs = h.notifications.join(' ')
    expect(msgs).toContain('Volume 1')
    expect(msgs).toContain('Volume 2')
    expect(h.warned.has('volume_1')).toBe(true)
    expect(h.warned.has('volume_2')).toBe(true)
  })

  it('restart: state restored from store, no duplicate push if state matches reality', async () => {
    // Volume was already in warn state (restored from store), still at 92%
    const h = makeHarness(['volume_1'])
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 92)] },
    }

    await h.watcher.check()

    // Already warned — should NOT fire again
    expect(h.notifications).toHaveLength(0)
    expect(h.warned.has('volume_1')).toBe(true)
  })

  it('getStorageInfo returns error → watcher logs but does NOT crash; no notification', async () => {
    const h = makeHarness()
    h.getStorageResult = { ok: false, reason: 'Connection refused' }

    // Should not throw
    await expect(h.watcher.check()).resolves.toBeUndefined()
    expect(h.notifications).toHaveLength(0)
  })

  it('warning message includes volume name, percentage, used and total', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 90)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(1)
    const msg = h.notifications[0]
    // Must include volume name and percentage indicator
    expect(msg).toContain('Volume 1')
    expect(msg).toContain('%')
  })

  it('notify throws on warning → markWarned NOT persisted → next tick retries the alert', async () => {
    const notifications: string[] = []
    const warned = new Set<string>()
    let failNext = true
    let storageResult: { ok: true; data: StorageInfo } = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 92)] },
    }

    const watcher = new DiskUsageWatcher({
      getStorageInfo: async () => storageResult,
      isVolumeWarned: async (id) => warned.has(id),
      markWarned: async (id) => { warned.add(id) },
      clearWarned: async (id) => { warned.delete(id) },
      notify: async (msg) => {
        if (failNext) throw new Error('telegram down')
        notifications.push(msg)
      },
      highPct: 90,
      lowPct: 85,
    })

    // First tick: notify fails (caught per-volume) → state must NOT be persisted
    await watcher.check()
    expect(notifications).toHaveLength(0)
    expect(warned.has('volume_1')).toBe(false)

    // Second tick: notify succeeds → alert delivered, state committed
    failNext = false
    await watcher.check()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('⚠️')
    expect(warned.has('volume_1')).toBe(true)
  })

  it('notify throws on recovery → clearWarned NOT persisted → next tick retries', async () => {
    const notifications: string[] = []
    const warned = new Set<string>(['volume_1'])
    let failNext = true

    const watcher = new DiskUsageWatcher({
      getStorageInfo: async () => ({
        ok: true,
        data: { volumes: [makeVolume('volume_1', 'Volume 1', 80)] },
      }),
      isVolumeWarned: async (id) => warned.has(id),
      markWarned: async (id) => { warned.add(id) },
      clearWarned: async (id) => { warned.delete(id) },
      notify: async (msg) => {
        if (failNext) throw new Error('telegram down')
        notifications.push(msg)
      },
      highPct: 90,
      lowPct: 85,
    })

    await watcher.check()
    expect(notifications).toHaveLength(0)
    expect(warned.has('volume_1')).toBe(true)

    failNext = false
    await watcher.check()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('✅')
    expect(warned.has('volume_1')).toBe(false)
  })

  it('notify succeeds → state persisted, no duplicate next tick', async () => {
    const h = makeHarness()
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 92)] },
    }

    await h.watcher.check()
    expect(h.notifications).toHaveLength(1)
    expect(h.warned.has('volume_1')).toBe(true)

    await h.watcher.check()
    expect(h.notifications).toHaveLength(1)
  })

  it('recovery message includes volume name and percentage', async () => {
    const h = makeHarness(['volume_1'])
    h.getStorageResult = {
      ok: true,
      data: { volumes: [makeVolume('volume_1', 'Volume 1', 80)] },
    }

    await h.watcher.check()

    expect(h.notifications).toHaveLength(1)
    const msg = h.notifications[0]
    expect(msg).toContain('Volume 1')
    expect(msg).toContain('%')
  })
})
