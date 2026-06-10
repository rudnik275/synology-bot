// Tests for DownloadsTab Variant B card (#116) + Variant A skeleton loader (#115):
//   - One status accent (edge stripe via Card, not badge/tone)
//   - Exactly one primary action per status group (or none)
//   - Delete is a TWO-TAP inline confirm: tapping trash arms the card → the action
//     group morphs to [cancel ×][confirm ✓]; the confirm tap issues the DELETE
//   - Pending (optimistic) card: empty progress bar + known info (size/dest) +
//     skeletons for the unknown, instead of a spinner + «Добавляем…» text
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
import { useOptimisticTasks } from '../src/composables/useOptimisticTasks'
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

    expect(wrapper.text()).toContain('Нет загрузок')
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

  // ── Inline add-row (#249) ────────────────────────────────────────────────────

  it('shows the inline add-row as first item in the task list', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab, { props: { onAddClick: () => {} } })
    await flushPromises()

    expect(wrapper.find('[data-testid="add-row"]').exists()).toBe(true)
  })

  it('shows the inline add-row in the empty-state action slot', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    const wrapper = mount(DownloadsTab, { props: { onAddClick: () => {} } })
    await flushPromises()

    expect(wrapper.find('[data-testid="add-row"]').exists()).toBe(true)
  })

  it('clicking the add-row calls onAddClick', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    let called = false
    const wrapper = mount(DownloadsTab, { props: { onAddClick: () => { called = true } } })
    await flushPromises()

    await wrapper.find('[data-testid="add-row"]').trigger('click')
    expect(called).toBe(true)
  })

  // ── Primary action — exactly one per status group (icon-only, #249) ──────────

  it('shows an icon-only primary action button for downloading task (no text label)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const btn = wrapper.find('[data-testid="btn-primary-task-1"]')
    expect(btn.exists()).toBe(true)
    // Icon-only: no text content (just an SVG)
    expect(btn.text()).toBe('')
    // Should have an aria-label so it's accessible
    expect(btn.attributes('aria-label')).toBeTruthy()
  })

  it('shows an icon-only primary action button for paused task (no text label)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [pausedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const btn = wrapper.find('[data-testid="btn-primary-task-2"]')
    expect(btn.exists()).toBe(true)
    // Icon-only: no text content (just an SVG)
    expect(btn.text()).toBe('')
    // Should have an aria-label so it's accessible
    expect(btn.attributes('aria-label')).toBeTruthy()
  })

  it('shows NO primary action for finished task (only delete)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [finishedTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const primaryBtn = wrapper.find('[data-testid="btn-primary-task-3"]')
    expect(primaryBtn.exists()).toBe(false)

    // delete (trash) button must still be present
    const deleteBtn = wrapper.find('[data-testid="btn-delete-task-3"]')
    expect(deleteBtn.exists()).toBe(true)
  })

  it('shows NO primary action for error task (only delete)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [errorTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const primaryBtn = wrapper.find('[data-testid="btn-primary-task-4"]')
    expect(primaryBtn.exists()).toBe(false)

    const deleteBtn = wrapper.find('[data-testid="btn-delete-task-4"]')
    expect(deleteBtn.exists()).toBe(true)
  })

  // ── Two-tap inline delete confirm (round-3) ────────────────────────────────

  it('the delete (trash) button is shown directly on the card — no menu reveal', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // There is no overflow ⋯ menu trigger anymore; delete is the direct button.
    expect(wrapper.find('[data-testid="btn-overflow-task-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-delete-task-1"]').exists()).toBe(true)
  })

  it('first tap on trash ARMS the card (shows confirm + cancel) and does NOT delete yet', async () => {
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

    // Before arming: no confirm/cancel buttons exist.
    expect(wrapper.find('[data-testid="btn-confirm-delete-task-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-cancel-delete-task-1"]').exists()).toBe(false)

    // First tap on the trash button arms the card.
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    // The confirm + cancel buttons now exist; the pause/trash pair is replaced.
    expect(wrapper.find('[data-testid="btn-confirm-delete-task-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-cancel-delete-task-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-delete-task-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-primary-task-1"]').exists()).toBe(false)

    // No DELETE has fired yet — the first tap only arms.
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
  })

  it('cancel returns to the normal pause/trash buttons without deleting', async () => {
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

    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="btn-cancel-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    // Back to the default pair; nothing was deleted.
    expect(wrapper.find('[data-testid="btn-delete-task-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-primary-task-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-confirm-delete-task-1"]').exists()).toBe(false)
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
  })

  it('the confirm tap issues the DELETE (two-tap total)', async () => {
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

    // Tap 1: arm.
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    // Tap 2: confirm.
    await wrapper.find('[data-testid="btn-confirm-delete-task-1"]').trigger('click')
    await flushPromises()

    const deleteCall = calls.find(
      (c) => c.url.startsWith(`/api/tasks/${downloadingTask.id}`) && c.init?.method === 'DELETE',
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
    const loadingState = wrapper.find('[aria-label="Загрузка списка"]')
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
    expect(wrapper.find('[aria-label="Загрузка списка"]').exists()).toBe(false)

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

describe('DownloadsTab — optimistic placeholder + delete feedback (#269)', () => {
  it('renders the optimistic placeholder when the real list is empty (task 09)', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    // A download was just added — its optimistic placeholder lives in the singleton
    // store. Before the fix the empty-list EmptyState/skeleton hid it, so the user
    // saw a blank screen for the ~20–30 s the real task took to be indexed (#269 task 09).
    useOptimisticTasks().add({ title: 'Pending Movie 2160p', destination: '/downloads' })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    expect(wrapper.text()).toContain('Pending Movie 2160p')
    expect(wrapper.text()).not.toContain('Нет загрузок')
    expect(wrapper.find('.sk-card').exists()).toBe(false)
  })

  it('pending card draws an EMPTY progress bar instead of a spinner + «Добавляем…» text (round-3)', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    useOptimisticTasks().add({ title: 'Queued Movie', destination: '/downloads' })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // The old spinner + text are gone.
    expect(wrapper.text()).not.toContain('Добавляем на NAS')
    expect(wrapper.find('.spinner').exists()).toBe(false)

    // An empty progress bar (aria-valuenow 0) stands in.
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('aria-valuenow')).toBe('0')
  })

  it('pending card shows a 0% + «0 B / size» readout instead of skeletons (no-skeleton redesign)', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    const optimistic = useOptimisticTasks()
    // Known size from an inspected add → rendered as «0 B / 1.9 GB».
    optimistic.add({ title: 'Known Size', destination: '/downloads', sizeBytes: 2_000_000_000 })
    // Unknown size (magnet) → «0 B / 0 B», same as a real just-started task.
    optimistic.add({ title: 'Unknown Size', destination: '/downloads' })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // The skeleton placeholders are gone for good.
    expect(wrapper.find('.meta-size-sk').exists()).toBe(false)
    expect(wrapper.find('.meta-pct-sk').exists()).toBe(false)

    // Both pending cards read «0%»; the known-size one shows its total after «0 B /».
    const pcts = wrapper.findAll('.meta-pct').map((n) => n.text())
    expect(pcts.filter((t) => t === '0%').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.text()).toContain('0 B / 1.9 GB')
    expect(wrapper.text()).toContain('0 B / 0 B')
  })

  it('pending card has a working delete that cancels by the real DSM id', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      return Promise.resolve(jsonResponse({ tasks: [] }))
    }) as typeof fetch

    const optimistic = useOptimisticTasks()
    const oid = optimistic.add({ title: 'Cancel Me', destination: '/downloads' })
    // The add resolved with the real DSM id (attachRealId), so cancel is immediate.
    optimistic.attachRealId(oid, 'dbid_real_1')

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // The pending card is the only card → its trash button is the only delete.
    const trash = wrapper.find('.action-seg--delete')
    expect(trash.exists()).toBe(true)

    // Two-tap: arm, then confirm.
    await trash.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid^="btn-confirm-delete-"]').trigger('click')
    await flushPromises()

    // DELETE hit the REAL id, not the optimistic placeholder id.
    const del = calls.find((c) => c.init?.method === 'DELETE')
    expect(del).toBeDefined()
    expect(del!.url).toContain('/api/tasks/dbid_real_1')
    expect(del!.url).not.toContain('optimistic-')
    // The placeholder is dropped.
    expect(wrapper.text()).not.toContain('Cancel Me')
  })

  it('pending card delete defers until the real id arrives, then cancels', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ? { ...init } : undefined })
      return Promise.resolve(jsonResponse({ tasks: [] }))
    }) as typeof fetch

    const optimistic = useOptimisticTasks()
    const oid = optimistic.add({ title: 'Defer Me', destination: '/downloads' })
    // NOTE: no realId yet — the add request hasn't resolved.

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Arm + confirm while the real id is still unknown → no DELETE can fire yet.
    await wrapper.find('.action-seg--delete').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid^="btn-confirm-delete-"]').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
    // The confirm button shows a spinner while waiting.
    expect(wrapper.find('[data-testid^="btn-confirm-delete-"] .spinner').exists()).toBe(true)

    // The add resolves → attachRealId → the deferred delete fires automatically.
    optimistic.attachRealId(oid, 'dbid_late')
    await flushPromises()

    const del = calls.find((c) => c.init?.method === 'DELETE')
    expect(del).toBeDefined()
    expect(del!.url).toContain('/api/tasks/dbid_late')
    expect(wrapper.text()).not.toContain('Defer Me')
  })

  it('pending card renders quality chips it already knows from the add (round-3)', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    useOptimisticTasks().add({
      title: 'Chips Movie',
      destination: '/downloads',
      year: 2024,
      quality: ['2160p', 'HDR'],
    })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const chipTexts = wrapper.findAll('.chip').map((c) => c.text())
    expect(chipTexts).toContain('2024')
    expect(chipTexts).toContain('2160p')
    expect(chipTexts).toContain('HDR')
  })

  it('shows a spinner + disables the confirm button while a delete is in-flight, then removes the task (round-3)', async () => {
    let resolveDelete!: () => void
    const deleteGate = new Promise<void>((r) => { resolveDelete = r })
    let deleted = false
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'DELETE') {
        return deleteGate.then(() => { deleted = true; return jsonResponse({ ok: true }) })
      }
      return Promise.resolve(jsonResponse({ tasks: deleted ? [] : [downloadingTask] }))
    }) as typeof fetch

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // Tap 1: arm. Tap 2: confirm — the delete is gated so it stays in-flight.
    await wrapper.find('[data-testid="btn-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="btn-confirm-delete-task-1"]').trigger('click')
    await wrapper.vm.$nextTick()

    // In-flight: the confirm button shows a spinner and is disabled (so is cancel).
    const confirmBtn = wrapper.find('[data-testid="btn-confirm-delete-task-1"]')
    expect(confirmBtn.attributes('disabled')).toBeDefined()
    expect(confirmBtn.find('.spinner').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-cancel-delete-task-1"]').attributes('disabled')).toBeDefined()

    // Resolve the delete → the task leaves the list.
    resolveDelete()
    await flushPromises()
    expect(wrapper.text()).not.toContain(downloadingTask.title)
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

// ── Failed-add card (#288) ─────────────────────────────────────────────────────
// A background add that rejected: AddFlow rolls the placeholder back AND records
// the failure in useAddFailures; DownloadsTab pins a red «Ошибка добавления»
// card above the list until the owner dismisses it — a failed add never
// silently vanishes anymore.
describe('DownloadsTab — failed-add card (#288)', () => {
  it('renders a failure as a red-striped card with the error message', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    const { useAddFailures } = await import('../src/composables/useAddFailures')
    useAddFailures().add({
      title: 'Broken Movie 1080p',
      destination: '/downloads/movies',
      message: 'destination is required',
    })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    // The card shows: title, the failed-add status label, and the error message.
    expect(wrapper.text()).toContain('Broken Movie 1080p')
    expect(wrapper.text()).toContain('Ошибка добавления')
    expect(wrapper.text()).toContain('Не удалось добавить: destination is required')
    // Red edge stripe — failure accent.
    const failedCard = wrapper.find('.task-card--failed')
    expect(failedCard.exists()).toBe(true)
    // It must NOT be swallowed by the empty state.
    expect(wrapper.text()).not.toContain('Нет загрузок')
    expect(wrapper.find('.sk-card').exists()).toBe(false)
  })

  it('the dismiss ✕ removes the failure card', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [] }))) as typeof fetch
    const { useAddFailures } = await import('../src/composables/useAddFailures')
    const store = useAddFailures()
    const fid = store.add({ title: 'Dismiss Me', destination: null, message: 'boom' })

    const wrapper = mount(DownloadsTab)
    await flushPromises()
    expect(wrapper.text()).toContain('Dismiss Me')

    await wrapper.find(`[data-testid="add-failed-dismiss-${fid}"]`).trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Dismiss Me')
    expect(store.failures).toHaveLength(0)
  })

  it('failure cards render above pending placeholders and real tasks', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ tasks: [downloadingTask] }))) as typeof fetch
    const { useAddFailures } = await import('../src/composables/useAddFailures')
    useAddFailures().add({ title: 'Failed First', destination: null, message: 'err' })
    useOptimisticTasks().add({ title: 'Pending Second', destination: '/downloads' })

    const wrapper = mount(DownloadsTab)
    await flushPromises()

    const titles = wrapper.findAll('.task-title').map((n) => n.text())
    expect(titles[0]).toBe('Failed First')
    expect(titles.indexOf('Failed First')).toBeLessThan(titles.indexOf('Pending Second'))
  })
})
