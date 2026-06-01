// Tests for FolderPicker component — Variant D (#122).
// Primary screen: known-folder tiles (favorites+recents).
// Tree drill-down is behind "Выбрать другую папку…".
// No history → tree shown directly.
// Mocks globalThis.fetch to serve /api/folders responses.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import FolderPicker from '../src/components/FolderPicker.vue'

const LS_RECENTS = 'nas-bot:folder-recents'
const LS_FAVORITES = 'nas-bot:folder-favorites'
const LS_LAST = 'nas-bot:last-folder'

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  // Clear localStorage shortcuts between tests
  localStorage.removeItem(LS_RECENTS)
  localStorage.removeItem(LS_FAVORITES)
  localStorage.removeItem(LS_LAST)

  // default: roots → two shared folders
  globalThis.fetch = ((url: string) => {
    if (url === '/api/folders') {
      return Promise.resolve(
        jsonResponse({ folders: [
          { name: 'downloads', path: '/volume1/downloads' },
          { name: 'media', path: '/volume1/media' },
        ] })
      )
    }
    if (url.includes('path=')) {
      return Promise.resolve(
        jsonResponse({ folders: [
          { name: 'torrents', path: '/volume1/downloads/torrents' },
        ] })
      )
    }
    return Promise.resolve(jsonResponse({ folders: [] }))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  localStorage.removeItem(LS_RECENTS)
  localStorage.removeItem(LS_FAVORITES)
  localStorage.removeItem(LS_LAST)
})

// ── Variant D: tiles-first behaviour ──────────────────────────────────────────

describe('FolderPicker — tiles-first (Variant D)', () => {
  it('shows tiles when recents are present', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
  })

  it('shows tiles when favorites are present', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/volume1/media']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
  })

  it('renders one tile per shortcut (favorites first)', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/volume1/media']))
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads', '/volume1/media']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    const tileBtns = wrapper.findAll('[data-testid="folder-tile"]')
    // media (fav) + downloads (recent-only) = 2 tiles
    expect(tileBtns.length).toBe(2)
    // first tile = favorite (media)
    expect(tileBtns[0]!.text()).toContain('media')
  })

  it('caps tiles at 6', async () => {
    const paths = Array.from({ length: 8 }, (_, i) => `/volume1/f${i}`)
    localStorage.setItem(LS_RECENTS, JSON.stringify(paths))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    const tileBtns = wrapper.findAll('[data-testid="folder-tile"]')
    expect(tileBtns.length).toBeLessThanOrEqual(6)
  })

  it('tapping a tile emits update:modelValue and advances in one tap (no need to click Next)', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    const tile = wrapper.find('[data-testid="folder-tile"]')
    expect(tile.exists()).toBe(true)
    await tile.trigger('click')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBe('/volume1/downloads')
  })

  it('tree is NOT shown on the primary (tiles) screen', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(false)
  })

  it('opens tree drill-down via "Выбрать другую папку" button', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    const moreBtn = wrapper.find('[data-testid="open-tree-btn"]')
    expect(moreBtn.exists()).toBe(true)
    await moreBtn.trigger('click')
    await flushPromises()

    // Tree should now be visible with root folders
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('downloads')
  })

  it('back-to-tiles button returns to tiles view after opening tree', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Open tree
    await wrapper.find('[data-testid="open-tree-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(true)

    // Go back to tiles
    const backBtn = wrapper.find('[data-testid="back-to-tiles-btn"]')
    expect(backBtn.exists()).toBe(true)
    await backBtn.trigger('click')

    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
  })
})

// ── No history: tree shown directly ──────────────────────────────────────────

describe('FolderPicker — no history: tree directly (Variant D)', () => {
  it('shows tree immediately when no recents or favorites', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    // No tiles
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(false)
    // Tree root folders visible
    expect(wrapper.text()).toContain('downloads')
    expect(wrapper.text()).toContain('media')
  })

  it('no back-to-tiles button when no history exists', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="back-to-tiles-btn"]').exists()).toBe(false)
  })

  it('fetches and renders root folders on mount', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('downloads')
    expect(text).toContain('media')
  })

  it('drills into a child folder when clicked', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    const folderBtns = wrapper.findAll('[data-testid="folder-item"]')
    expect(folderBtns.length).toBeGreaterThan(0)
    await folderBtns[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('torrents')
  })

  it('shows pick-btn ("Сохранить сюда") after drilling in', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Not at root — no pick button
    expect(wrapper.find('[data-testid="pick-btn"]').exists()).toBe(false)

    // Drill in
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="pick-btn"]').exists()).toBe(true)
  })

  it('emits update:modelValue when "Сохранить сюда" is clicked', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Drill in to get the pick button
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()

    const pickBtn = wrapper.find('[data-testid="pick-btn"]')
    expect(pickBtn.exists()).toBe(true)
    await pickBtn.trigger('click')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBeTruthy()
  })

  it('shows up button after drilling in', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Initially no up button (at root)
    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(false)

    // Drill in
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(true)
  })

  it('navigates up when up button is clicked', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('torrents')

    await wrapper.find('[data-testid="up-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('downloads')
  })

  it('shows loading state while fetching', async () => {
    let resolveFetch!: (r: Response) => void
    globalThis.fetch = (() => new Promise<Response>((r) => { resolveFetch = r })) as typeof fetch

    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    // Wait one microtask so onMounted fires and sets loading = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true)

    resolveFetch(jsonResponse({ folders: [{ name: 'x', path: '/x' }] }))
    await flushPromises()
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
  })
})

// ── lastFolder restore (stale path guard) ─────────────────────────────────────

describe('FolderPicker — shortcuts / lastFolder restore', () => {
  beforeEach(() => {
    localStorage.removeItem(LS_RECENTS)
    localStorage.removeItem(LS_FAVORITES)
    localStorage.removeItem(LS_LAST)

    globalThis.fetch = ((url: string) => {
      if (url === '/api/folders') {
        return Promise.resolve(
          jsonResponse({ folders: [
            { name: 'downloads', path: '/volume1/downloads' },
            { name: 'media', path: '/volume1/media' },
          ] })
        )
      }
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    localStorage.removeItem(LS_RECENTS)
    localStorage.removeItem(LS_FAVORITES)
    localStorage.removeItem(LS_LAST)
  })

  it('opens into lastFolder on mount — reconstructs breadcrumb stack (no tiles → tree directly)', async () => {
    localStorage.setItem(LS_LAST, '/volume1/downloads')
    // Mock: root returns downloads; downloads path returns torrents child
    globalThis.fetch = ((url: string) => {
      if (url === '/api/folders') {
        return Promise.resolve(
          jsonResponse({ folders: [
            { name: 'downloads', path: '/volume1/downloads' },
            { name: 'media', path: '/volume1/media' },
          ] })
        )
      }
      if (url.includes('path=') && url.includes('downloads')) {
        return Promise.resolve(
          jsonResponse({ folders: [{ name: 'torrents', path: '/volume1/downloads/torrents' }] })
        )
      }
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    // No recents/favorites: goes to tree directly and restores lastFolder
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Should have drilled into downloads - up button visible
    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(true)
    // breadcrumb or folder list should contain torrents (children of downloads)
    expect(wrapper.text()).toContain('torrents')
  })
})
