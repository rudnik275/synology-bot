import { describe, it, expect, beforeEach } from 'bun:test'
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

function makeDisk(id: string, model: string, temp: number, status = 'normal', smart_status = 'normal'): DiskEntry {
  return { id, model, temp, status, smart_status }
}

interface TestHarness {
  watcher: DiskHealthWatcher
  store: FakeStore
  pushes: string[]
  setDisks(disks: DiskEntry[]): void
}

function makeHarness(tempHigh = 50, tempLow = 45): TestHarness {
  const store = makeFakeStore()
  const pushes: string[] = []
  let disks: DiskEntry[] = []

  const watcher = new DiskHealthWatcher({
    getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
    getState: (event, resourceId) => store.getState(event, resourceId),
    setState: (event, resourceId, state) => store.setState(event, resourceId, state),
    notify: async (message: string) => { pushes.push(message) },
    tempHigh,
    tempLow,
  })

  return {
    watcher,
    store,
    pushes,
    setDisks(d: DiskEntry[]) { disks = d },
  }
}

// ---- Tests ----

describe('DiskHealthWatcher – temperature', () => {
  it('disk at 40°C → no push, state stays ok', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40)])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('disk at 50°C (= tempHigh) → 🌡 push, state becomes hot', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 50)])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('🌡 WD Red перегрев: 50°C')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('disk at 48°C when already hot → no push, stays hot (hysteresis)', async () => {
    const h = makeHarness()
    // First tick: heat up
    h.setDisks([makeDisk('disk1', 'WD Red', 55)])
    await h.watcher.check()
    expect(h.pushes).toHaveLength(1)
    h.pushes.length = 0

    // Second tick: still hot (48 > tempLow=45 but < tempHigh=50 → hysteresis)
    h.setDisks([makeDisk('disk1', 'WD Red', 48)])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
  })

  it('disk at 45°C (= tempLow) when hot → ✅ recovery push, state becomes ok', async () => {
    const h = makeHarness()
    // Start hot
    h.setDisks([makeDisk('disk1', 'WD Red', 55)])
    await h.watcher.check()
    h.pushes.length = 0

    // Cool down to exactly tempLow
    h.setDisks([makeDisk('disk1', 'WD Red', 45)])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('✅ WD Red температура в норме (45°C)')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('ok')
  })

  it('disk at 55°C → second check same temp → no duplicate push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 55)])

    await h.watcher.check()
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
  })
})

describe('DiskHealthWatcher – SMART', () => {
  it('disk with smart_status=normal, status=normal → no push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(0)
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')
  })

  it('disk with smart_status=warning → ❌ SMART push, state warn', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'warning')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('❌ WD Red SMART: warning, status: normal')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')
  })

  it('disk with status=warning → ❌ SMART push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'warning', 'normal')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('❌ WD Red SMART: normal, status: warning')
  })

  it('disk with smart_status=warning → second check → no duplicate push', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'warning')])

    await h.watcher.check()
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
  })

  it('SMART warn → both return to normal → ✅ recovery push, state ok', async () => {
    const h = makeHarness()
    // Start with SMART warning
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'warning')])
    await h.watcher.check()
    h.pushes.length = 0

    // Recovery
    h.setDisks([makeDisk('disk1', 'WD Red', 40, 'normal', 'normal')])
    await h.watcher.check()

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]).toBe('✅ WD Red SMART восстановлен')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('ok')
  })
})

describe('DiskHealthWatcher – combined and multi-disk', () => {
  it('disk simultaneously hot AND smart warn → two separate pushes', async () => {
    const h = makeHarness()
    h.setDisks([makeDisk('disk1', 'WD Red', 55, 'normal', 'warning')])

    await h.watcher.check()

    expect(h.pushes).toHaveLength(2)
    const tempPush = h.pushes.find(p => p.includes('перегрев'))
    const smartPush = h.pushes.find(p => p.includes('SMART:'))
    expect(tempPush).toBe('🌡 WD Red перегрев: 55°C')
    expect(smartPush).toBe('❌ WD Red SMART: warning, status: normal')
    expect(h.store.getState('disk_temp', 'disk1')).toBe('hot')
    expect(h.store.getState('disk_smart', 'disk1')).toBe('warn')
  })

  it('two disks with different events → independent state', async () => {
    const h = makeHarness()
    h.setDisks([
      makeDisk('disk1', 'WD Red', 55),     // hot
      makeDisk('disk2', 'Seagate', 40),    // ok
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
    const disks = [makeDisk('disk1', 'WD Red', 55, 'normal', 'warning')]

    // Simulate previous run: states already in store
    store.setState('disk_temp', 'disk1', 'hot')
    store.setState('disk_smart', 'disk1', 'warn')

    const watcher = new DiskHealthWatcher({
      getDiskInfo: async () => ({ ok: true as const, data: { disks } }),
      getState: (event, resourceId) => store.getState(event, resourceId),
      setState: (event, resourceId, state) => store.setState(event, resourceId, state),
      notify: async (message: string) => { pushes.push(message) },
      tempHigh: 50,
      tempLow: 45,
    })

    await watcher.check()

    // Already hot and warn → no new pushes
    expect(pushes).toHaveLength(0)
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
      tempHigh: 50,
      tempLow: 45,
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
      tempHigh: 50,
      tempLow: 45,
    })

    await expect(watcher.check()).resolves.toBeUndefined()
    expect(pushes).toHaveLength(0)
  })
})
