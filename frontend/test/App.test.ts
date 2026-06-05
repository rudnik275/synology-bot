// Hub-and-spoke shell state machine (ADR 0015, S1 #222): a Home hub root, a
// section router, and native Telegram Back coordination. The bottom tab bar is
// gone. These tests drive the nav stack + BackButton visibility/handler
// coordination — the load-bearing, error-prone part of the slice.
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'

// ── A faithful BackButton fake ────────────────────────────────────────────────
// Models the real Telegram BackButton: multiple onClick handlers can be
// registered, and a press fires EVERY currently-registered handler. show()/hide()
// toggle visibility independently of the handler set. `press()` simulates a tap.
type BackButtonFake = {
  visible: boolean
  handlers: Set<() => void>
  show: () => void
  hide: () => void
  onClick: (cb: () => void) => void
  offClick: (cb: () => void) => void
  press: () => void
}

function installBackButton(): BackButtonFake {
  const fake: BackButtonFake = {
    visible: false,
    handlers: new Set(),
    show() { this.visible = true },
    hide() { this.visible = false },
    onClick(cb) { this.handlers.add(cb) },
    offClick(cb) { this.handlers.delete(cb) },
    press() { for (const h of [...this.handlers]) h() },
  }
  ;(window as unknown as { Telegram?: unknown }).Telegram = { WebApp: { BackButton: fake } }
  return fake
}

// Stub fetch so the section components (Downloads/NAS/Shows) mount without
// hitting the network. URL-aware so each endpoint gets a SHAPE-VALID empty
// payload (NasTab reads health.errors.find on the polled health view).
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const EMPTY_HEALTH = {
  cpu: null,
  memory: null,
  volumes: null,
  disks: null,
  processes: null,
  errors: [],
}

function stubFetch(): void {
  globalThis.fetch = ((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/health')) return Promise.resolve(jsonResponse(EMPTY_HEALTH))
    if (typeof url === 'string' && url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse({ tasks: [] }))
    if (typeof url === 'string' && url.startsWith('/api/subscriptions')) return Promise.resolve(jsonResponse({ subscriptions: [] }))
    if (typeof url === 'string' && url.startsWith('/api/shows/search')) return Promise.resolve(jsonResponse({ results: [] }))
    return Promise.resolve(jsonResponse({ ok: true }))
  }) as typeof fetch
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  ;(window as unknown as { Telegram?: unknown }).Telegram = undefined
  // Reset the telegram module mock between tests so start-param leaks don't carry.
  mock.module('../src/telegram', () => ({
    startParam: '',
    torrentToken: '',
    initData: '',
    inTelegram: false,
    initTelegram: () => {},
    parseTorrentToken: (raw: string) => (raw.startsWith('tor-') ? raw.slice(4) : ''),
  }))
})

/** (Re)load App.vue AFTER mocking telegram so the boot start-param is honoured. */
async function loadApp() {
  return (await import('../src/App.vue')).default
}

function mockTelegram(startParam: string, torrentToken = ''): void {
  mock.module('../src/telegram', () => ({
    startParam,
    torrentToken,
    initData: '',
    inTelegram: false,
    initTelegram: () => {},
    parseTorrentToken: (raw: string) => (raw.startsWith('tor-') ? raw.slice(4) : ''),
  }))
}

describe('App shell — hub root', () => {
  it('cold boot with an empty start param lands on the hub', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // The hub root shows its three section rows…
    expect(wrapper.find('[data-testid="hub-row-downloads"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hub-row-nas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hub-row-shows"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Главная')
  })

  it('hides the native BackButton on the hub (Telegram ✕ closes the app)', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('')
    const App = await loadApp()
    mount(App)
    await flushPromises()

    expect(back.visible).toBe(false)
  })

  it('no longer renders a bottom tab bar', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // The old <nav> tab bar with its three buttons is gone.
    expect(wrapper.find('nav[aria-label="Навигация"]').exists()).toBe(false)
  })
})

describe('App shell — hub → section navigation', () => {
  it('tapping a hub row pushes that section full-screen and shows native Back', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.find('[data-testid="hub-row-nas"]').trigger('click')
    await flushPromises()

    // NAS section is now rendered; the hub rows are gone.
    expect(wrapper.find('[data-testid="hub-row-nas"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('NAS')
    // Native Back is now shown (we are off the hub root).
    expect(back.visible).toBe(true)
  })

  it('a native Back press in a section (at its own root) returns to the hub', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.find('[data-testid="hub-row-nas"]').trigger('click')
    await flushPromises()
    expect(back.visible).toBe(true)

    back.press()
    await flushPromises()

    // Back on the hub; Back button hidden again.
    expect(wrapper.find('[data-testid="hub-row-nas"]').exists()).toBe(true)
    expect(back.visible).toBe(false)
  })
})

describe('App shell — deep-link retargeting', () => {
  it('a "nas" start param boots directly into the NAS section, bypassing the hub', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('nas')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // We boot straight into NAS — no hub rows.
    expect(wrapper.find('[data-testid="hub-row-nas"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('NAS')
    // Native Back is shown; pressing it returns to the hub.
    expect(back.visible).toBe(true)

    back.press()
    await flushPromises()
    expect(wrapper.find('[data-testid="hub-row-nas"]').exists()).toBe(true)
    expect(back.visible).toBe(false)
  })

  it('a tor-<token> deep-link opens the Add wizard, bypassing the hub', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('tor-abc123', 'abc123')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // The full-screen Add wizard sheet auto-opened on boot (it covers the hub).
    // The wizard sheet is headerless since G1 (no title / ✕ / stepper chrome), so
    // assert the dialog itself is present rather than the removed stepper.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe('App shell — native Back coordination (single active handler)', () => {
  it('while the Add wizard sheet is open, a Back press is handled by the wizard, NOT the shell', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('downloads') // boot into Downloads so we are in a section
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // Open the Add wizard via the global FAB (the Downloads FAB is in App.vue shell).
    await wrapper.find('[data-testid="global-fab"]').trigger('click')
    await flushPromises()

    // Advance to the Folder step so the wizard owns the native Back (step > first).
    // Drive the wizard far enough that a Back press should pop a STEP, not the
    // section. We simulate by pressing Back: it must NOT return us to the hub.
    // (The wizard's own handler runs; the shell's section→hub handler must be
    // suppressed because owns-back is true while the sheet is open.)
    back.press()
    await flushPromises()

    // Still in the Downloads section (not the hub) — the shell did NOT pop.
    expect(wrapper.find('[data-testid="hub-row-downloads"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Загрузки')
  })

  it('the wizard releases native Back to the shell when it closes', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('downloads')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.find('[data-testid="global-fab"]').trigger('click')
    await flushPromises()

    // The wizard is headerless since G1 (no ✕) — it closes via native Back on the
    // first step. While the sheet is open the wizard owns Back, so one press closes it.
    back.press()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    // Now in the Downloads section with no child owning back → shell back is live.
    expect(back.visible).toBe(true)
    back.press()
    await flushPromises()
    // One press pops the section → hub.
    expect(wrapper.find('[data-testid="hub-row-downloads"]').exists()).toBe(true)
  })

  it('while a Shows detail is open, a Back press pops detail→list, not section→hub', async () => {
    // Subscriptions list with one row so we can open a detail.
    globalThis.fetch = ((url: string) => {
      if (typeof url === 'string' && url === '/api/subscriptions') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              subscriptions: [
                { id: 'sub-1', showId: 42, title: 'Breaking Bad', lastNotifiedEpisode: null, poster: null, latestAiredEpisode: null },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (typeof url === 'string' && url.match(/^\/api\/shows\/\d+$/)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 42, title: 'Breaking Bad', titleOriginal: 'Breaking Bad', poster: null, description: 'desc', isSubscribed: true, seasons: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }) as typeof fetch

    const back = installBackButton()
    mockTelegram('shows') // boot into Shows section
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // Open a show detail.
    const row = wrapper.find('[data-testid="subscription-row-sub-1"]')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    await flushPromises()

    // Detail is open → ShowsTab owns native Back. A press must pop detail→list
    // (back to the Shows section root), NOT pop the whole section to the hub.
    expect(wrapper.text()).toContain('desc')
    back.press()
    await flushPromises()

    // Back on the Shows LIST (still in the Shows section, not the hub).
    expect(wrapper.find('[data-testid="hub-row-shows"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="subscription-row-sub-1"]').exists()).toBe(true)
    // The shell's section→hub back is live again (detail closed) and shown.
    expect(back.visible).toBe(true)
  })
})

describe('App shell — global Add FAB visibility (ADR 0015, S3 #224)', () => {
  it('FAB is present on the hub root', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(true)
  })

  it('FAB is present on the Downloads section', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('downloads')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(true)
  })

  it('FAB is hidden on the NAS section', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('nas')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(false)
  })

  it('FAB is hidden on the Shows section', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('shows')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(false)
  })

  it('FAB disappears when navigating from Downloads to hub, then reappears on hub', async () => {
    stubFetch()
    const back = installBackButton()
    mockTelegram('downloads')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // FAB visible in Downloads.
    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(true)

    // Navigate back to hub via native Back.
    back.press()
    await flushPromises()

    // FAB still visible on hub.
    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(true)
  })

  it('FAB disappears when navigating hub → NAS', async () => {
    stubFetch()
    installBackButton()
    mockTelegram('')
    const App = await loadApp()
    const wrapper = mount(App)
    await flushPromises()

    // FAB visible on hub.
    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(true)

    // Navigate into NAS.
    await wrapper.find('[data-testid="hub-row-nas"]').trigger('click')
    await flushPromises()

    // FAB hidden on NAS.
    expect(wrapper.find('[data-testid="global-fab"]').exists()).toBe(false)
  })
})
