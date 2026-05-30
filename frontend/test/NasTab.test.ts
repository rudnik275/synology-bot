// Tests for NasTab and useHealth composable (#70).
// TDD: these were written first (failing), then the implementation was added.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createApp } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import NasTab from '../src/tabs/NasTab.vue'
import type { HealthView } from '../src/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { result, unmount: () => app.unmount() }
}

const FULL_HEALTH: HealthView = {
  cpu: { userLoad: 30, systemLoad: 10 },
  memory: { usedBytes: 2 * 1024 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 * 1024, pct: 25 },
  volumes: [
    { path: '/volume1', usedBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 50, status: 'normal' },
    { path: '/volume2', usedBytes: 800 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 80, status: 'normal' },
  ],
  disks: [
    { model: 'WD Red 4TB', tempC: 38, tempStatus: 'normal', status: 'good', smart: 'Passed' },
    { model: 'Seagate 8TB', tempC: 42, tempStatus: 'elevated', status: 'good', smart: 'Passed' },
  ],
  processes: {
    topRam: [
      { name: 'synofsd', bytes: 512 * 1024 * 1024 },
      { name: 'pkg-synolog', bytes: 256 * 1024 * 1024 },
    ],
    topCpu: [
      { name: 'ffmpeg', pct: 45.2 },
      { name: 'synofsd', pct: 12.1 },
    ],
  },
  errors: [],
}

const PARTIAL_HEALTH: HealthView = {
  cpu: { userLoad: 20, systemLoad: 5 },
  memory: { usedBytes: 1 * 1024 ** 3, totalBytes: 4 * 1024 ** 3, pct: 25 },
  volumes: null,
  disks: [{ model: 'WD Red 4TB', tempC: 35, tempStatus: 'normal', status: 'good', smart: 'Passed' }],
  processes: null,
  errors: [
    { section: 'storage', reason: 'Synology API timeout' },
    { section: 'processes', reason: 'Permission denied' },
  ],
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// ─── NasTab component ────────────────────────────────────────────────────────
// NasTab uses the useHealth singleton. Because all tests share the same module
// instance, we drive tests via direct refetch() calls so each test controls
// exactly what data is visible regardless of singleton state.

async function mountWithData(health: HealthView) {
  globalThis.fetch = (() => Promise.resolve(jsonResponse(health))) as typeof fetch
  const wrapper = mount(NasTab)
  await flushPromises()
  // If onMounted fetch didn't run (no instance), call refetch manually
  if (!wrapper.text().includes(Object.keys(health).join(''))) {
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()
    await flushPromises()
  }
  return wrapper
}

describe('NasTab — full data render', () => {
  it('shows CPU and RAM sections when health data arrives', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    // Drive the singleton directly so this test is deterministic
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    // CPU section
    expect(text).toContain('CPU')
    expect(text).toContain('30')   // userLoad
    expect(text).toContain('10')   // systemLoad
    // RAM section
    expect(text).toContain('RAM')
    // just confirm memory section visible (formatBytes produces GB output)
    expect(text).toMatch(/\d+(\.\d+)?\s*GB/)
  })

  it('shows volumes with basename and pct', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('volume1')
    expect(text).toContain('volume2')
    expect(text).toContain('50%')
    expect(text).toContain('80%')
  })

  it('shows disks with model and temperature', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('WD Red 4TB')
    expect(text).toContain('38')
    expect(text).toContain('Seagate 8TB')
    expect(text).toContain('Passed')
  })

  it('shows top-RAM and top-CPU processes', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('synofsd')
    expect(text).toContain('ffmpeg')
  })
})

describe('NasTab — partial failure resilience', () => {
  it('renders a degraded card for null volumes with reason from errors[]', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(PARTIAL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    // degraded card shows the reason
    expect(text).toContain('Synology API timeout')
    // volumes section not listed normally (null)
    expect(text).not.toContain('volume1')
  })

  it('still renders other sections when volumes is null', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(PARTIAL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    // CPU + memory still present
    expect(text).toContain('CPU')
    expect(text).toContain('RAM')
    // disks still present
    expect(text).toContain('WD Red 4TB')
  })

  it('renders a degraded card for null processes with reason from errors[]', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(PARTIAL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Permission denied')
    expect(text).not.toContain('ffmpeg')
  })

  it('does not crash — mounts without throwing', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(PARTIAL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    expect(() => mount(NasTab)).not.toThrow()
  })
})

describe('NasTab — error state', () => {
  it('shows an error message when the API returns an error and there is no stale data', async () => {
    // Reset the singleton to a clean error-only state (no stale data).
    // We do this by clearing data ref directly via the composable.
    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    // Clear stale data so the error branch is reachable
    health.data.value = null

    globalThis.fetch = (() => Promise.resolve(jsonResponse({ error: 'NAS unreachable' }, 503))) as typeof fetch
    await health.refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    expect(wrapper.text()).toContain('NAS unreachable')
  })
})

// ─── useHealth chipStatus + chipMetric derivation ────────────────────────────
// The singleton shares state across tests. We drive it via refetch() directly.

describe('useHealth chip derivations', () => {
  it('chipStatus is ok when no volumes exceed 80% and all disks are good', async () => {
    const okHealth: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/volume1', usedBytes: 300 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 30, status: 'normal' },
      ],
      disks: [{ model: 'WD', tempC: 35, tempStatus: 'normal', status: 'good', smart: 'Passed' }],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(okHealth))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipStatus.value).toBe('ok')
    expect(health.chipMetric.value).toMatch(/volume1\s+30%/)
  })

  it('chipStatus is warn when a volume pct >= 80', async () => {
    const warnHealth: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/vol1', usedBytes: 850 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 85, status: 'normal' },
      ],
      disks: [{ model: 'WD', tempC: 35, tempStatus: 'normal', status: 'good', smart: 'Passed' }],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(warnHealth))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipStatus.value).toBe('warn')
  })

  it('chipStatus is bad when a volume pct >= 90', async () => {
    const badHealth: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/vol1', usedBytes: 950 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 95, status: 'normal' },
      ],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(badHealth))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipStatus.value).toBe('bad')
  })

  it('chipStatus is bad when a disk status indicates failure', async () => {
    const badDiskHealth: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/vol1', usedBytes: 300 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 30, status: 'normal' },
      ],
      disks: [{ model: 'WD', tempC: 35, tempStatus: 'normal', status: 'failure', smart: 'Failed' }],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(badDiskHealth))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipStatus.value).toBe('bad')
  })

  it('chipStatus is warn when a disk tempStatus is elevated', async () => {
    const warnDiskHealth: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/vol1', usedBytes: 300 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 30, status: 'normal' },
      ],
      disks: [{ model: 'WD', tempC: 55, tempStatus: 'elevated', status: 'good', smart: 'Passed' }],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(warnDiskHealth))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipStatus.value).toBe('warn')
  })

  it('chipMetric shows the busiest volume basename + pct', async () => {
    const multiVol: HealthView = {
      ...FULL_HEALTH,
      volumes: [
        { path: '/volume1', usedBytes: 300 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 30, status: 'normal' },
        { path: '/volume2', usedBytes: 700 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 70, status: 'normal' },
      ],
      disks: [{ model: 'WD', tempC: 35, tempStatus: 'normal', status: 'good', smart: 'Passed' }],
      errors: [],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(multiVol))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    // busiest is volume2 at 70%
    expect(health.chipMetric.value).toMatch(/volume2\s+70%/)
  })

  it('chipMetric is "—" when volumes is null', async () => {
    const noVols: HealthView = { ...FULL_HEALTH, volumes: null, errors: [] }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(noVols))) as typeof fetch

    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    await health.refetch()

    expect(health.chipMetric.value).toBe('—')
  })

  it('chipStatus is unknown when data is null', async () => {
    const { useHealth } = await import('../src/composables/useHealth')
    const health = useHealth()
    // Manually clear data to simulate "no data yet" state
    health.data.value = null

    expect(health.chipStatus.value).toBe('unknown')
    expect(health.chipMetric.value).toBe('—')
  })
})

// ─── per-item severity helpers (#102) ────────────────────────────────────────
// These are the thresholds extracted out of chipStatus so NasTab can colour
// individual volumes/disks. They must agree with the chip thresholds above.

describe('severity helpers', () => {
  it('volumeSeverity: ok < 80 ≤ warn < 90 ≤ bad, and failed status is bad', async () => {
    const { volumeSeverity } = await import('../src/composables/useHealth')
    expect(volumeSeverity({ pct: 50, status: 'normal' })).toBe('ok')
    expect(volumeSeverity({ pct: 80, status: 'normal' })).toBe('warn')
    expect(volumeSeverity({ pct: 89, status: 'normal' })).toBe('warn')
    expect(volumeSeverity({ pct: 90, status: 'normal' })).toBe('bad')
    expect(volumeSeverity({ pct: 10, status: 'failure' })).toBe('bad')
  })

  it('diskSeverity: failed status/SMART is bad, elevated temp is warn, else ok', async () => {
    const { diskSeverity } = await import('../src/composables/useHealth')
    expect(diskSeverity({ tempStatus: 'normal', status: 'good', smart: 'Passed' })).toBe('ok')
    expect(diskSeverity({ tempStatus: 'elevated', status: 'good', smart: 'Passed' })).toBe('warn')
    expect(diskSeverity({ tempStatus: 'normal', status: 'failure', smart: 'Passed' })).toBe('bad')
    expect(diskSeverity({ tempStatus: 'normal', status: 'good', smart: 'Failed' })).toBe('bad')
  })

  it('pctSeverity: plain percentage thresholds (RAM)', async () => {
    const { pctSeverity } = await import('../src/composables/useHealth')
    expect(pctSeverity(25)).toBe('ok')
    expect(pctSeverity(85)).toBe('warn')
    expect(pctSeverity(95)).toBe('bad')
  })
})

// ─── NasTab redesign — hero + severity rendering (#102) ───────────────────────

describe('NasTab — redesigned presentation', () => {
  it('promotes the busiest volume to the hero and shows the screen title', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()
    const wrapper = mount(NasTab)
    await flushPromises()

    expect(wrapper.find('.screen-title').text()).toBe('NAS')
    // busiest of {volume1:50, volume2:80} is volume2 → hero
    const hero = wrapper.find('.hero')
    expect(hero.exists()).toBe(true)
    expect(hero.text()).toContain('volume2')
    expect(hero.text()).toContain('80%')
    // warn severity (80%) paints the hero amber, not yellow
    expect(hero.classes()).toContain('fill-orange')
  })

  it('renders Top RAM as a donut (with a free segment) and keeps Top CPU as bars', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse(FULL_HEALTH))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()
    const wrapper = mount(NasTab)
    await flushPromises()

    // RAM donut: legend lists the process + a "free" remainder
    const donut = wrapper.find('.donut-wrap')
    expect(donut.exists()).toBe(true)
    expect(donut.text()).toContain('synofsd')
    expect(donut.text()).toContain('free')
    // CPU stays ranked bars (process %CPU is not part-to-whole)
    const procRows = wrapper.findAll('.proc')
    expect(procRows.length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('ffmpeg')
  })

  it('keys disk rows by model+index so same-model bays do not collide', async () => {
    const dupModel: HealthView = {
      ...FULL_HEALTH,
      disks: [
        { model: 'WD Red 4TB', tempC: 38, tempStatus: 'normal', status: 'good', smart: 'Passed' },
        { model: 'WD Red 4TB', tempC: 53, tempStatus: 'elevated', status: 'good', smart: 'Failed' },
      ],
    }
    globalThis.fetch = (() => Promise.resolve(jsonResponse(dupModel))) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()
    const wrapper = mount(NasTab)
    await flushPromises()

    const rows = wrapper.findAll('.disk')
    expect(rows).toHaveLength(2)
    // the failed-SMART bay reads as bad (red edge)
    expect(rows[1]!.classes()).toContain('edge-red')
  })
})
