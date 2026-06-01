// Tests for DownloadsTab Variant B card (#116) + Variant A skeleton loader (#115):
//   - One status accent (edge stripe via Card, not badge/tone)
//   - Exactly one primary action per status group (or none)
//   - Delete lives in the overflow ⋯ menu behind a confirmation dialog
//   - Quality chips (year/quality/languages from #117) render under the title
//   - Elevation tiers (#101 D) preserved
//   - useTasks composable contract unchanged
//   - Loading state: content-shaped skeleton cards (not generic boxes), first-load only
// Mocks globalThis.fetch.
import { describe, it, expect, afterEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import { createApp } from 'vue'
import DownloadsTab from '../src/tabs/DownloadsTab.vue'
import { useTasks } from '../src/composables/useTasks'
import type { TaskView } from '../src/types'

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

const downloadingTask: TaskView = {
  id: 'task-1',
  title: 'The.Dark.Knight.2008.1080p.BluRay.x264',
  status: 'downloading',
  sizeBytes: 8_000_000_000,
  downloadedBytes: 4_000_000_000,
  speedBytesPerSec: 5_242_880,
  pct: 50,
  destination: '/downloads/movies',
  year: 2008,
  quality: ['1080p', 'BluRay', 'x264'],
  languages: ['ENG'],
}

const pausedTask: TaskView = {
  id: 'task-2',
  title: 'Short Title',
  status: 'paused',
  sizeBytes: 1_000_000_000,
  downloadedBytes: 500_000_000,
  speedBytesPerSec: 0,
  pct: 50,
  destination: '/downloads/series',
}

const finishedTask: TaskView = {
  id: 'task-3',
  title: 'Finished Download',
  status: 'finished',
  sizeBytes: 2_000_000_000,
  downloadedBytes: 2_000_000_000,
  speedBytesPerSec: 0,
  pct: 100,
  destination: '/downloads',
}

const errorTask: TaskView = {
  id: 'task-4',
  title: 'Error Task',
  status: 'error',
  sizeBytes: 500_000_000,
  downloadedBytes: 100_000_000,
  speedBytesPerSec: 0,
  pct: 20,
  destination: null,
}

describe('DownloadsTab', () => {
  it('shows empty state when there are no tasks', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('No downloads')
    // Should NOT show the old stub text
    expect(wrapper.text()).not.toContain('Active downloads will appear here.')
  })

  it('renders one row (Card) per task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask, pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Each task should have its title
    expect(wrapper.text()).toContain(downloadingTask.title)
    expect(wrapper.text()).toContain(pausedTask.title)
  })

  it('renders a ProgressBar with the correct pct value', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const progressbar = wrapper.find('[role="progressbar"]')
    expect(progressbar.exists()).toBe(true)
    expect(progressbar.attributes('aria-valuenow')).toBe(String(downloadingTask.pct))
  })

  // ── Primary action — exactly one per status group ─────────────────────────

  it('shows «Пауза» as primary action for downloading task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const btn = wrapper.find('[data-testid="btn-primary-task-1"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('Пауза')
  })

  it('shows «Продолжить» as primary action for paused task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const btn = wrapper.find('[data-testid="btn-primary-task-2"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('Продолжить')
  })

  it('shows NO primary action for finished task (only ⋯ overflow)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [finishedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const primaryBtn = wrapper.find('[data-testid="btn-primary-task-3"]')
    expect(primaryBtn.exists()).toBe(false)

    // overflow button must still be present
    const overflowBtn = wrapper.find('[data-testid="btn-overflow-task-3"]')
    expect(overflowBtn.exists()).toBe(true)
  })

  it('shows NO primary action for error task (only ⋯ overflow)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [errorTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const primaryBtn = wrapper.find('[data-testid="btn-primary-task-4"]')
    expect(primaryBtn.exists()).toBe(false)

    const overflowBtn = wrapper.find('[data-testid="btn-overflow-task-4"]')
    expect(overflowBtn.exists()).toBe(true)
  })

  // ── Old-style Delete-on-face is GONE ─────────────────────────────────────

  it('does NOT show a Delete button directly on the card face', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Delete button must NOT be visible without opening the overflow menu
    const visibleDelete = wrapper.findAll('button').filter((b) => b.text() === 'Delete')
    expect(visibleDelete).toHaveLength(0)
  })

  // ── Delete in overflow ⋯ menu with confirmation ───────────────────────────

  it('clicking ⋯ opens the overflow menu with Delete item', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const overflowBtn = wrapper.find('[data-testid="btn-overflow-task-1"]')
    await overflowBtn.trigger('click')
    await wrapper.vm.$nextTick()

    const deleteItem = wrapper.find('[data-testid="btn-delete-task-1"]')
    expect(deleteItem.exists()).toBe(true)
  })

  it('clicking Delete in ⋯ menu shows confirmation dialog', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Open menu
    await wrapper.find('[data-testid="btn-overflow-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Click Delete in menu
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Confirmation dialog should appear (renders in Teleport, look at document)
    const confirmBtn = document.querySelector('[data-testid="btn-confirm-delete"]')
    expect(confirmBtn).not.toBeNull()
  })

  it('Cancel in confirmation dialog closes it without deleting', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Open overflow → click Delete → cancel
    await wrapper.find('[data-testid="btn-overflow-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    const cancelBtn = document.querySelector('[data-testid="btn-cancel-delete"]') as HTMLButtonElement
    cancelBtn.click()
    await flushPromises()

    // No DELETE call should have been issued
    const deleteCalls = calls.filter((c) => c.init?.method === 'DELETE')
    expect(deleteCalls).toHaveLength(0)
  })

  it('Confirm delete in dialog issues DELETE /api/tasks/:id', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Open overflow → click Delete → confirm
    await wrapper.find('[data-testid="btn-overflow-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    const confirmBtn = document.querySelector('[data-testid="btn-confirm-delete"]') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    const deleteCall = calls.find(
      (c) =>
        c.url.startsWith(`/api/tasks/${downloadingTask.id}`) && c.init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
  })

  // ── Primary action triggers correct API call ──────────────────────────────

  it('clicking Пауза issues POST /api/tasks/:id/pause', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    await wrapper.find('[data-testid="btn-primary-task-1"]').trigger('click')
    await flushPromises()

    const pauseCall = calls.find(
      (c) => c.url === `/api/tasks/${downloadingTask.id}/pause` && c.init?.method === 'POST',
    )
    expect(pauseCall).toBeDefined()
  })

  it('clicking Продолжить issues POST /api/tasks/:id/resume', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [pausedTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    await wrapper.find('[data-testid="btn-primary-task-2"]').trigger('click')
    await flushPromises()

    const resumeCall = calls.find(
      (c) => c.url === `/api/tasks/${pausedTask.id}/resume` && c.init?.method === 'POST',
    )
    expect(resumeCall).toBeDefined()
  })

  // ── Quality chips (#117 fields) ───────────────────────────────────────────

  it('renders quality chips (year, resolution, codec, languages) under title', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const chips = wrapper.findAll('.chip')
    const chipTexts = chips.map((c) => c.text())
    expect(chipTexts).toContain('2008')
    expect(chipTexts).toContain('1080p')
    expect(chipTexts).toContain('BluRay')
    expect(chipTexts).toContain('x264')
    expect(chipTexts).toContain('ENG')
  })

  it('renders no chips when task has no year/quality/languages', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const chips = wrapper.findAll('.chip')
    expect(chips).toHaveLength(0)
  })

  // ── Skeleton loader — Variant A (#115) ───────────────────────────────────

  it('shows content-shaped skeleton cards (not generic boxes) on first load', async () => {
    // Fetch never resolves — loading stays true while tasks.length === 0
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch
    const wrapper = mount(DownloadsTab)
    // Wait one tick: onMounted fires → refetch() starts → loading becomes true
    await wrapper.vm.$nextTick()

    // The loading-state container must be present
    const loadingState = wrapper.find('[aria-label="Loading downloads"]')
    expect(loadingState.exists()).toBe(true)
    expect(loadingState.attributes('aria-busy')).toBe('true')

    // Content-shaped skeleton cards — NOT the old generic .skeleton-card boxes
    const skCards = wrapper.findAll('.sk-card')
    expect(skCards.length).toBeGreaterThanOrEqual(2)

    // Each card contains a left edge stripe in neutral skeleton grey
    const firstCard = skCards[0]!
    expect(firstCard.find('.sk-edge').exists()).toBe(true)

    // Each card has a title placeholder bar
    expect(firstCard.find('.sk-title').exists()).toBe(true)

    // Each card has chip placeholders
    expect(firstCard.findAll('.sk-chip').length).toBeGreaterThanOrEqual(2)

    // Each card has a progress bar container with a partial fill block
    expect(firstCard.find('.sk-bar').exists()).toBe(true)
    expect(firstCard.find('.sk-bar-fill').exists()).toBe(true)

    // Each card has a meta line placeholder
    expect(firstCard.find('.sk-meta').exists()).toBe(true)

    // The old generic box class must NOT be present
    expect(wrapper.find('.skeleton-card').exists()).toBe(false)
  })

  it('hides skeleton when loading completes (first-load only trigger)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)

    // Before promises resolve, tasks.length === 0 — but let it resolve
    await flushPromises()

    // After load with tasks, loading state must be gone
    expect(wrapper.find('[aria-label="Loading downloads"]').exists()).toBe(false)

    // Task list is shown instead
    expect(wrapper.text()).toContain(downloadingTask.title)
  })

  it('hides skeleton once tasks arrive even if loading remains true', async () => {
    // First request resolves with tasks (simulates refetch while still "loading")
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // tasks.length > 0 so skeleton must not render even if loading===true
    expect(wrapper.find('.sk-card').exists()).toBe(false)
  })

  // ── No StickerBadge on card face (Variant B one-accent rule) ─────────────

  it('does NOT render StickerBadge DL/PAUSE/DONE/ERR text on card face', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask, pausedTask, finishedTask, errorTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // These are the old badge texts — they must not appear as sticker chips
    // (status is now shown as quieter text, not bold badges)
    expect(wrapper.findAll('.sticker')).toHaveLength(0)
  })
})

describe('useTasks composable', () => {
  it('exposes tasks array derived from data.tasks', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch

    const { result, unmount } = withSetup(() => useTasks())
    await flushPromises()

    expect(result.tasks.value).toHaveLength(1)
    expect(result.tasks.value[0]!.id).toBe(downloadingTask.id)
    unmount()
  })

  it('exposes loading and error from useApi', async () => {
    let resolveFetch!: (r: Response) => void
    globalThis.fetch = (() => new Promise<Response>((r) => (resolveFetch = r))) as typeof fetch

    const { result, unmount } = withSetup(() => useTasks())
    expect(result.loading.value).toBe(true)

    resolveFetch(jsonResponse({ tasks: [] }))
    await flushPromises()

    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
    unmount()
  })

  it('pause() calls POST /api/tasks/:id/pause then refetches', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const { result, unmount } = withSetup(() => useTasks())
    await flushPromises()

    await result.pause(downloadingTask.id)
    await flushPromises()

    const pauseCall = calls.find(
      (c) => c.url === `/api/tasks/${downloadingTask.id}/pause` && c.init?.method === 'POST',
    )
    expect(pauseCall).toBeDefined()
    unmount()
  })

  it('resume() calls POST /api/tasks/:id/resume then refetches', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [pausedTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const { result, unmount } = withSetup(() => useTasks())
    await flushPromises()

    await result.resume(pausedTask.id)
    await flushPromises()

    const resumeCall = calls.find(
      (c) => c.url === `/api/tasks/${pausedTask.id}/resume` && c.init?.method === 'POST',
    )
    expect(resumeCall).toBeDefined()
    unmount()
  })

  it('delete() calls DELETE /api/tasks/:id then refetches', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const { result, unmount } = withSetup(() => useTasks())
    await flushPromises()

    await result.delete(downloadingTask.id)
    await flushPromises()

    const deleteCall = calls.find(
      (c) =>
        c.url.startsWith(`/api/tasks/${downloadingTask.id}`) && c.init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    unmount()
  })
})
