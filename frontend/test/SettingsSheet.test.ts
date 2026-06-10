// Settings sheet (#305): loads current values from GET /api/settings, validates
// inline (ranges + cross-field, mirroring the server), saves via PUT.
// The Sheet teleports to document.body, so assertions query the document
// (same pattern as AddFlow tests).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import SettingsSheet from '../src/components/SettingsSheet.vue'
import NasTab from '../src/tabs/NasTab.vue'
import type { SettingsView, HealthView } from '../src/types'

const SETTINGS: SettingsView = {
  diskUsageHighPct: 90,
  diskUsageLowPct: 85,
  diskTempWarnC: 50,
  diskTempBadC: 56,
  digestHour: 9,
  autoCleanerRetentionDays: 7,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const realFetch = globalThis.fetch
let putBodies: string[]

beforeEach(() => {
  putBodies = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if ((url as string).includes('/api/settings')) {
      if (init?.method === 'PUT') {
        putBodies.push(init.body as string)
        return Promise.resolve(jsonResponse({ settings: SETTINGS }))
      }
      return Promise.resolve(jsonResponse({ settings: SETTINGS }))
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
})

function input(key: keyof SettingsView): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`[data-testid="settings-input-${key}"]`)
  if (!el) throw new Error(`input for ${key} not found`)
  return el
}

function setInput(key: keyof SettingsView, value: string): void {
  const el = input(key)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mountOpen() {
  const wrapper = mount(SettingsSheet, { props: { open: true } })
  await flushPromises()
  return wrapper
}

describe('SettingsSheet — load + render', () => {
  it('prefills every input from GET /api/settings', async () => {
    await mountOpen()

    expect(input('diskUsageHighPct').value).toBe('90')
    expect(input('diskUsageLowPct').value).toBe('85')
    expect(input('diskTempWarnC').value).toBe('50')
    expect(input('diskTempBadC').value).toBe('56')
    expect(input('digestHour').value).toBe('9')
    expect(input('autoCleanerRetentionDays').value).toBe('7')
  })

  it('shows a load error when GET fails', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ error: 'boom' }, 502))) as typeof fetch
    await mountOpen()

    expect(document.querySelector('[data-testid="settings-load-error"]')).not.toBeNull()
  })
})

describe('SettingsSheet — save flow', () => {
  it('PUTs the edited values and shows saved feedback', async () => {
    await mountOpen()

    setInput('digestHour', '18')
    setInput('diskUsageHighPct', '95')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    await flushPromises()

    expect(putBodies).toHaveLength(1)
    const body = JSON.parse(putBodies[0]!) as Partial<SettingsView>
    expect(body.digestHour).toBe(18)
    expect(body.diskUsageHighPct).toBe(95)
    // unchanged fields still sent as integers (full validated form)
    expect(body.autoCleanerRetentionDays).toBe(7)

    expect(document.querySelector('[data-testid="settings-save"]')!.textContent).toContain('Сохранено')
  })

  it('out-of-range value → inline error, no PUT', async () => {
    await mountOpen()

    setInput('digestHour', '24')
    document.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    await flushPromises()

    expect(putBodies).toHaveLength(0)
    const error = document.querySelector('[data-testid="settings-error-digestHour"]')
    expect(error).not.toBeNull()
    expect(error!.textContent).toContain('0–23')
  })

  it('low >= high → inline cross-field error, no PUT', async () => {
    await mountOpen()

    setInput('diskUsageLowPct', '92') // high is 90
    document.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    await flushPromises()

    expect(putBodies).toHaveLength(0)
    expect(document.querySelector('[data-testid="settings-error-diskUsageLowPct"]')).not.toBeNull()
  })

  it('shows a save error when the PUT fails', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ error: 'invalid settings' }, 400))
      return Promise.resolve(jsonResponse({ settings: SETTINGS }))
    }) as typeof fetch
    await mountOpen()

    document.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    await flushPromises()

    expect(document.querySelector('[data-testid="settings-save-error"]')).not.toBeNull()
  })
})

// ── Entry point: gear button on the NAS tab ──────────────────────────────────

const HEALTH: HealthView = {
  cpu: { userLoad: 30, systemLoad: 10 },
  memory: { usedBytes: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3, pct: 25 },
  volumes: [
    { path: '/volume1', usedBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, pct: 50, status: 'normal' },
  ],
  disks: [{ model: 'WD Red 4TB', tempC: 38, tempStatus: 'normal', status: 'good', smart: 'Passed' }],
  processes: { topRam: [], topCpu: [] },
  errors: [],
}

describe('NasTab — settings entry (#305)', () => {
  it('shows a gear button that opens the settings sheet', async () => {
    globalThis.fetch = ((url: string) => {
      if ((url as string).includes('/api/settings')) return Promise.resolve(jsonResponse({ settings: SETTINGS }))
      return Promise.resolve(jsonResponse(HEALTH))
    }) as typeof fetch
    const { useHealth } = await import('../src/composables/useHealth')
    await useHealth().refetch()

    const wrapper = mount(NasTab)
    await flushPromises()

    const gear = wrapper.find('[data-testid="open-settings"]')
    expect(gear.exists()).toBe(true)

    await gear.trigger('click')
    await flushPromises()

    // The sheet teleports to body and loads the settings
    expect(document.querySelector('[data-testid="settings-input-digestHour"]')).not.toBeNull()
  })
})
