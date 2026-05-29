// Tests for DownloadsTab (#61): task rows, status badges, progress values,
// action buttons (pause/resume/delete), empty state. Mocks globalThis.fetch.
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

  it('shows DL badge for downloading task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('DL')
  })

  it('shows PAUSE badge for paused task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('PAUSE')
  })

  it('shows DONE badge for finished task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [finishedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('DONE')
  })

  it('shows ERR badge for error task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [errorTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('ERR')
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

  it('shows Pause button for downloading task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const pauseBtn = buttons.find((b) => b.text() === 'Pause')
    expect(pauseBtn).toBeDefined()
    expect(pauseBtn!.exists()).toBe(true)
  })

  it('shows Resume button for paused task', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const resumeBtn = buttons.find((b) => b.text() === 'Resume')
    expect(resumeBtn).toBeDefined()
    expect(resumeBtn!.exists()).toBe(true)
  })

  it('always shows a Delete button', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const deleteBtn = buttons.find((b) => b.text() === 'Delete')
    expect(deleteBtn).toBeDefined()
    expect(deleteBtn!.exists()).toBe(true)
  })

  it('clicking Pause issues POST /api/tasks/:id/pause', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    let callCount = 0
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      callCount++
      // First call: GET /api/tasks; subsequent: mutation + refetch
      if ((init?.method ?? 'GET') === 'GET' || !init?.method) {
        return Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const pauseBtn = buttons.find((b) => b.text() === 'Pause')!
    await pauseBtn.trigger('click')
    await flushPromises()

    const pauseCall = calls.find(
      (c) => c.url === `/api/tasks/${downloadingTask.id}/pause` && c.init?.method === 'POST',
    )
    expect(pauseCall).toBeDefined()
  })

  it('clicking Resume issues POST /api/tasks/:id/resume', async () => {
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

    const buttons = wrapper.findAll('button')
    const resumeBtn = buttons.find((b) => b.text() === 'Resume')!
    await resumeBtn.trigger('click')
    await flushPromises()

    const resumeCall = calls.find(
      (c) => c.url === `/api/tasks/${pausedTask.id}/resume` && c.init?.method === 'POST',
    )
    expect(resumeCall).toBeDefined()
  })

  it('clicking Delete issues DELETE /api/tasks/:id', async () => {
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

    const buttons = wrapper.findAll('button')
    const deleteBtn = buttons.find((b) => b.text() === 'Delete')!
    await deleteBtn.trigger('click')
    await flushPromises()

    const deleteCall = calls.find(
      (c) =>
        c.url.startsWith(`/api/tasks/${downloadingTask.id}`) && c.init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
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
