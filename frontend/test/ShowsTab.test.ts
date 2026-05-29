// Tests for the Shows tab (#64): subscriptions CRUD + today-airing block.
// Follows the pattern from useApi.test.ts: mock globalThis.fetch, restore in afterEach,
// use flushPromises to settle reactive state.
import { describe, it, expect, afterEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import ShowsTab from '../src/tabs/ShowsTab.vue'
import type { SubscriptionView, TodayEpisodeView } from '../src/types'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const SUBSCRIPTIONS: SubscriptionView[] = [
  { id: 'sub-1', showId: 42, title: 'Breaking Bad', lastNotifiedEpisode: { season: 1, episode: 3 } },
  { id: 'sub-2', showId: 99, title: 'The Wire', lastNotifiedEpisode: null },
]

const TODAY_EPISODES: TodayEpisodeView[] = [
  { showId: 42, title: 'Breaking Bad', season: 2, episode: 5, airTime: '21:00' },
]

function makeFetch(
  subs: SubscriptionView[] = SUBSCRIPTIONS,
  today: TodayEpisodeView[] = TODAY_EPISODES,
): { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === '/api/subscriptions/today') {
      return Promise.resolve(jsonResponse({ episodes: today }))
    }
    if (url === '/api/subscriptions' && (!init?.method || init.method === 'GET')) {
      return Promise.resolve(jsonResponse({ subscriptions: subs }))
    }
    if (url === '/api/subscriptions' && init?.method === 'POST') {
      const newSub: SubscriptionView = { id: 'sub-new', showId: 100, title: 'New Show', lastNotifiedEpisode: null }
      return Promise.resolve(jsonResponse({ subscription: newSub }, 201))
    }
    if (typeof url === 'string' && url.startsWith('/api/subscriptions/') && init?.method === 'DELETE') {
      return Promise.resolve(jsonResponse({ ok: true }))
    }
    return Promise.resolve(jsonResponse({ ok: true }))
  }) as typeof fetch
  return { calls }
}

describe('ShowsTab — today-airing block', () => {
  it('renders today episodes when present', async () => {
    makeFetch()
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // today block should be visible
    expect(wrapper.text()).toContain('Breaking Bad')
    expect(wrapper.text()).toContain('21:00')
    // formatted episode: S02E05
    expect(wrapper.text()).toContain('S02E05')
  })

  it('hides the today block when no episodes', async () => {
    makeFetch(SUBSCRIPTIONS, [])
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // The "Today" heading should not appear
    const text = wrapper.text()
    expect(text).not.toContain('Today')
  })
})

describe('ShowsTab — subscriptions list', () => {
  it('renders each subscription with a formatted badge', async () => {
    makeFetch()
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // Breaking Bad has S01E03
    expect(wrapper.text()).toContain('Breaking Bad')
    expect(wrapper.text()).toContain('S01E03')

    // The Wire has null episode → shows NEW or — badge
    expect(wrapper.text()).toContain('The Wire')
    // Should contain NEW or — (not an undefined value)
    const wireSection = wrapper.text()
    const hasBadge = wireSection.includes('NEW') || wireSection.includes('—')
    expect(hasBadge).toBe(true)
  })

  it('zero-pads season and episode numbers', async () => {
    makeFetch([
      { id: 's1', showId: 1, title: 'Test Show', lastNotifiedEpisode: { season: 1, episode: 3 } },
    ])
    const wrapper = mount(ShowsTab)
    await flushPromises()
    expect(wrapper.text()).toContain('S01E03')
  })

  it('shows EmptyState when there are no subscriptions and not loading', async () => {
    makeFetch([], [])
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // Should see the empty state message
    expect(wrapper.text()).toContain('No shows')
  })
})

describe('ShowsTab — Add form', () => {
  it('posts showId as a number when Add is clicked', async () => {
    const { calls } = makeFetch()
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // Fill in the numeric showId input
    const input = wrapper.find('input[type="number"]')
    expect(input.exists()).toBe(true)
    await input.setValue('100')

    // Click the Add button
    const addBtn = wrapper.find('[data-testid="add-btn"]')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')
    await flushPromises()

    // Find the POST call
    const postCall = calls.find((c) => c.url === '/api/subscriptions' && c.init?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall!.init!.body as string) as { showId: number }
    expect(body.showId).toBe(100)
    expect(typeof body.showId).toBe('number')
  })

  it('clears the input on successful add', async () => {
    makeFetch()
    const wrapper = mount(ShowsTab)
    await flushPromises()

    const input = wrapper.find('input[type="number"]')
    await input.setValue('100')
    await wrapper.find('[data-testid="add-btn"]').trigger('click')
    await flushPromises()

    expect((input.element as HTMLInputElement).value).toBe('')
  })
})

describe('ShowsTab — Remove', () => {
  it('issues DELETE /api/subscriptions/:id when Remove is clicked', async () => {
    const { calls } = makeFetch()
    const wrapper = mount(ShowsTab)
    await flushPromises()

    // Find the first remove button
    const removeBtn = wrapper.find('[data-testid="remove-btn"]')
    expect(removeBtn.exists()).toBe(true)
    await removeBtn.trigger('click')
    await flushPromises()

    const deleteCall = calls.find((c) => c.url === '/api/subscriptions/sub-1' && c.init?.method === 'DELETE')
    expect(deleteCall).toBeDefined()
  })
})
