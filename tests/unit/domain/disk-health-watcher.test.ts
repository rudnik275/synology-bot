import { describe, it, expect } from 'bun:test'
import { DiskHealthWatcher } from '../../../src/domain/disk-health-watcher.ts'
import type { DiskEntry } from '../../../src/infra/synology/types.ts'

// ---- Helpers ----

type DiskHealthState = 'ok' | 'hot' | 'warn'

interface FakeStore {
  states: Map<string, DiskHealthState>
  getState: (event: string, resourceId: string) => DiskHealthState
  setState: (event: string, resourceId: string, state: DiskHealthState) => void
}

function makeFakeStore(): FakeStore {
  const states = new Map<string, DiskHealthState>()
  return {
    states,
    getState(event: string, resourceId: string): DiskHealthState {
      return states.get(`${event}:${resourceId}`) ?? 'ok'
    },
    setState(event: string, resourceId: string, state: DiskHealthState): void {
      states.set(`${event}:${resourceId}`, state)
    },
  }
}

function makeDisk(
  id: string,
  model: string,
  temp: number,
  temperature_status: DiskEntry['temperature_status'] = 'normal',
  status: DiskEntry['status'] = 'normal',
  smart_status: DiskEntry['smart_status'] = 'normal',
): DiskEntry {
  return { id, model, temp, temperature_status, status, smart_status }
}

interface TestHarness {
  watcher: DiskHealthWatcher
  store: FakeStore
  pushes: string[]
  setDisks(disks: DiskEntry[]): void
}

function makeHarness(): TestHarness {
  const store = makeFakeStore()
  const pushes: string[] = []
  let disks: DiskEntry[] = []

  const watcher = new DiskHealthWatcher({
    getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
    getState: (event, resourceId) => store.getState(event, resourceId),
    setState: (event, resourceId, state) => store.setState(event, resourceId, state),
    notify: async (message: string) => { pushes.push(message) },
  })

  return {
    watcher,
    store,
    pushes,
    setDisks(d: DiskEntry[]) { disks = d },
  }
}

// ---- Tests ----

describe('DiskHealthWatcher – temperature (Synology status-based)', () => {
  it('disk with temperature_status=normal → no push, stays ok', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('disk with temperature_status=critical → 🌡 push, state becomes hot', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('🌡 WD Red перегрев: 58°C (статус: critical)')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('disk with temperature_status=warning (was ok) → no push, stays ok', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 52, 'warning')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('hot disk with temperature_status=warning → no push, stays hot (hysteresis band)', async () => {
    const h = makeHarness()
    // First tick: critical
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical')])
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    h.pushes.length = 0

    // Second tick: warning — hysteresis, stay hot
    h.setDisks([makeDisk('disk1', 'WD Red', 53, 'warning')])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('hot disk with temperature_status=normal → ✅ recovery push, state becomes ok', async () => {
    const h = makeHarness()
    // Start hot
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical')])
    await h.watcher.check()
    h.pushes.length = 0

    // Cool down to normal
    h.setDisks([makeDisk('disk1', 'WD Red', 45, 'normal')])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('✅ WD Red температура в норме (45°C)')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('disk stays critical → second check → no duplicate push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical')])

    await h.watcher.check()
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
  })
})

describe('DiskHealthWatcher – configurable temp thresholds (#305)', () => {
  function makeThresholdHarness(thresholds: { warnC: number; badC: number }) {
    const store = makeFakeStore()
    const pushes: string[] = []
    let disks: DiskEntry[] = []
    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
      getState: (event, resourceId) => store.getState(event, resourceId),
      setState: (event, resourceId, state) => store.setState(event, resourceId, state),
      notify: async (message: string) => { pushes.push(message) },
      getTempThresholds: () => ({ ...thresholds }),
    })
    return { watcher, store, pushes, thresholds, setDisks(d: DiskEntry[]) { disks = d } }
  }

  it('classifies numerically from temp, ignoring the upstream temperature_status', async () => {
    const h = makeThresholdHarness({ warnC: 50, badC: 56 })
    // Upstream says 'normal' but 58°C >= badC → alert fires
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('🌡 WD Red перегрев: 58°C (статус: critical)')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('warn band [warnC, badC) keeps the current state (hysteresis)', async () => {
    const h = makeThresholdHarness({ warnC: 50, badC: 56 })
    h.setDisks([makeDisk('disk1', 'WD Red', 52, 'critical')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('reads the thresholds getter live on each tick', async () => {
    const h = makeThresholdHarness({ warnC: 50, badC: 56 })
    h.setDisks([makeDisk('disk1', 'WD Red', 48, 'normal')])

    // 48 < 56 → no alert
    await h.watcher.check()
    expect(h.pushes).toHaveLength(0)

    // Settings change between ticks: badC drops to 45 → same 48°C now alerts
    h.thresholds.warnC = 40
    h.thresholds.badC = 45
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('перегрев')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')

    // Raise thresholds back → recovery on next tick
    h.thresholds.warnC = 50
    h.thresholds.badC = 56
    h.pushes.length = 0
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('температура в норме')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })
})

describe('DiskHealthWatcher – SMART', () => {
  it('disk with smart_status=normal, status=normal → no push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')
  })

  it('disk with smart_status=warning → ❌ SMART push, state warn', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'warning')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('❌ WD Red SMART: warning, status: normal')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')
  })

  it('disk with status=warning → ❌ SMART push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'warning', 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('❌ WD Red SMART: normal, status: warning')
  })

  it('disk with smart_status=warning → second check → no duplicate push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'warning')])

    await h.watcher.check()
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
  })

  it('SMART warn → both return to normal → ✅ recovery push, state ok', async () => {
    const h = makeHarness()
    // Start with SMART warning
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'warning')])
    await h.watcher.check()
    h.pushes.length = 0

    // Recovery
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'normal')])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('✅ WD Red SMART восстановлен')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')
  })
})

describe('DiskHealthWatcher – combined and multi-disk', () => {
  it('disk simultaneously critical-temp AND smart-warn → two separate pushes', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical', 'normal', 'warning')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(2)
    const tempPush = h.pushes.find(p => p.includes('перегрев'))
    const smartPush = h.pushes.find(p => p.includes('SMART:'))
    expect(tempPush).toBe('🌡 WD Red перегрев: 58°C (статус: critical)')
    expect(smartPush).toBe('❌ WD Red SMART: warning, status: normal')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')
  })

  it('two disks with different temperature statuses → independent state', async () => {
    const h = makeHarness()
    h.setDisks([
      makeDisk('disk1', 'WD Red', 58, 'critical'),
      makeDisk('disk2', 'Seagate', 40, 'normal'),
    ])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('WD Red')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
    expect(h.store.getState('disk_temp', 'disk2')).toBe('ok')
  })

  it('restart: states restored from store, no duplicate pushes when nothing changed', async () => {
    const store = makeFakeStore()
    const pushes: string[] = []
    const disks = [makeDisk('disk1', 'WD Red', 58, 'critical', 'normal', 'warning')]

    // Simulate previous run: states already in store
    store.setState('disk_temp', 'disk1', 'hot')
    store.setState('disk_smart', 'disk1', 'warn')

    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
      getState: (event, resourceId) => store.getState(event, resourceId),
      setState: (event, resourceId, state) => store.setState(event, resourceId, state),
      notify: async (message: string) => { pushes.push(message) },
    })

    await watcher.check()

    // Already hot and warn → no new pushes
    expect(pushes).toHaveLength(0)
  })
})

describe('DiskHealthWatcher – send-then-commit', () => {
  function makeFlakyHarness(disks: DiskEntry[]) {
    const store = makeFakeStore()
    const pushes: string[] = []
    const flag = { failNext: true }
    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
      getState: (event, resourceId) => store.getState(event, resourceId),
      setState: (event, resourceId, state) => store.setState(event, resourceId, state),
      notify: async (message: string) => {
        if (flag.failNext) throw new Error('telegram down')
        pushes.push(message)
      },
    })
    return { watcher, store, pushes, flag }
  }

  it('notify throws on temp alert → state NOT persisted → next tick retries', async () => {
    const h = makeFlakyHarness([makeDisk('disk1', 'WD Red', 58, 'critical')])

    await expect(h.watcher.check()).rejects.toThrow('telegram down')
    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')

    h.flag.failNext = false
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('перегрев')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('notify throws on temp recovery → state stays hot → next tick retries', async () => {
    const h = makeFlakyHarness([makeDisk('disk1', 'WD Red', 45, 'normal')])
    h.store.setState('disk_temp', 'disk1', 'hot')

    await expect(h.watcher.check()).rejects.toThrow('telegram down')
    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')

    h.flag.failNext = false
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('температура в норме')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('notify throws on SMART alert → state NOT persisted → next tick retries', async () => {
    const h = makeFlakyHarness([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'warning')])

    await expect(h.watcher.check()).rejects.toThrow('telegram down')
    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')

    h.flag.failNext = false
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('SMART:')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')
  })

  it('notify throws on SMART recovery → state stays warn → next tick retries', async () => {
    const h = makeFlakyHarness([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal', 'normal')])
    h.store.setState('disk_smart', 'disk1', 'warn')

    await expect(h.watcher.check()).rejects.toThrow('telegram down')
    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')

    h.flag.failNext = false
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toContain('SMART восстановлен')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')
  })

  it('notify succeeds → state persisted, no duplicate push next tick', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 58, 'critical', 'normal', 'warning')])

    await h.watcher.check()
    expect(h.pushes).toHaveLength(2)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')

    await h.watcher.check()
    expect(h.pushes).toHaveLength(2)
  })
})

describe('DiskHealthWatcher – error handling', () => {
  it('getDiskInfo error → watcher logs but does not crash, no push', async () => {
    const pushes: string[] = []
    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => { throw new Error('network timeout') },
      getState: () => 'ok',
      setState: () => {},
      notify: async (message: string) => { pushes.push(message) },
    })

    // Should not throw
    await expect(watcher.check()).resolves.toBeUndefined()
    expect(pushes).toHaveLength(0)
  })

  it('getDiskInfo returns ok=false → no push, no crash', async () => {
    const pushes: string[] = []
    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => ({ ok: false as const, reason: 'API error' }),
      getState: () => 'ok',
      setState: () => {},
      notify: async (message: string) => { pushes.push(message) },
    })

    await expect(watcher.check()).resolves.toBeUndefined()
    expect(pushes).toHaveLength(0)
  })
})
