// Tests for the FolderPicker component (#2).
// Primary screen: a flat quick list = recents (top) + the default share's
// (/video) subfolders, so it's never empty. «Браузить все папки» opens a
// drill-down tree with a tappable breadcrumb (no "Up" button).
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

// Map a requested folder path → its children. `null` = the share root listing.
function foldersFor(path: string | null): Array<{ name: string; path: string }> {
  if (path === '/video') {
    return [
      { name: 'сериалы', path: '/video/сериалы' },
      { name: 'новое', path: '/video/новое' },
    ]
  }
  if (path === null) {
    return [
      { name: 'downloads', path: '/volume1/downloads' },
      { name: 'media', path: '/volume1/media' },
    ]
  }
  if (path === '/volume1/downloads') {
    return [{ name: 'torrents', path: '/volume1/downloads/torrents' }]
  }
  return []
}

function pathFromUrl(url: string): string | null {
  const m = url.match(/\/api\/folders(?:\?path=([^&]*))?$/)
  return m && m[1] ? decodeURIComponent(m[1]) : null
}

beforeEach(() => {
  localStorage.removeItem(LS_RECENTS)
  localStorage.removeItem(LS_FAVORITES)
  localStorage.removeItem(LS_LAST)
  globalThis.fetch = ((url: string) =>
    Promise.resolve(jsonResponse({ folders: foldersFor(pathFromUrl(url as string)) }))) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  localStorage.removeItem(LS_RECENTS)
  localStorage.removeItem(LS_FAVORITES)
  localStorage.removeItem(LS_LAST)
})

describe('FolderPicker — quick list (#2)', () => {
  it('seeds the quick list from the default share (/video) subfolders on cold start', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
    const tiles = wrapper.findAll('[data-testid="folder-tile"]')
    expect(tiles.length).toBe(2)
    expect(wrapper.text()).toContain('сериалы')
    expect(wrapper.text()).toContain('новое')
  })

  it('floats recent folders to the top of the quick list', async () => {
    localStorage.setItem(LS_RECENTS, JSON.stringify(['/volume1/downloads']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    const tiles = wrapper.findAll('[data-testid="folder-tile"]')
    // recent (downloads) first, then the two /video children
    expect(tiles[0]!.text()).toContain('downloads')
    expect(tiles.length).toBe(3)
  })

  it('caps the quick list at 8', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/volume1/f${i}`)
    localStorage.setItem(LS_RECENTS, JSON.stringify(paths))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="folder-tile"]').length).toBeLessThanOrEqual(8)
  })

  it('tapping a quick tile emits update:modelValue', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="folder-tile"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBe('/video/сериалы')
  })

  it('does not show the tree on the quick screen', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(false)
  })
})

describe('FolderPicker — browse tree (#2)', () => {
  async function openTree() {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="open-tree-btn"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('opens the tree via «Браузить все папки» and lists the shares', async () => {
    const wrapper = await openTree()
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('downloads')
    expect(wrapper.text()).toContain('media')
  })

  it('the back-to-tiles control returns to the quick list (#270 task 06: chevron + «Папки» label)', async () => {
    const wrapper = await openTree()
    const backToTiles = wrapper.find('[data-testid="back-to-tiles-btn"]')
    expect(backToTiles.exists()).toBe(true)
    // #270 task 06: the bare hamburger glyph (#200) read as confusing — the
    // control now carries a «Папки» label so it clearly means "back to folders".
    expect(backToTiles.text()).toContain('Папки')
    await backToTiles.trigger('click')
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
  })

  it('drills into a folder, showing children and a breadcrumb crumb', async () => {
    const wrapper = await openTree()
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('torrents')
    expect(wrapper.find('[data-testid="crumb"]').exists()).toBe(true)
  })

  it('drilling into a folder emits it as the destination', async () => {
    const wrapper = await openTree()
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted![emitted!.length - 1]![0]).toBe('/volume1/downloads')
  })

  it('the home breadcrumb crumb navigates back to the share root', async () => {
    const wrapper = await openTree()
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('torrents')
    await wrapper.find('[data-testid="crumb-root"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('downloads')
    expect(wrapper.text()).toContain('media')
  })

  it('has no "Up" button (replaced by the breadcrumb)', async () => {
    const wrapper = await openTree()
    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(false)
  })
})

describe('FolderPicker — exposed pop-one-level nav (G1 #216)', () => {
  // The parent (AddFlow) consults canStepBack()/stepBack() on a native Back press
  // so Back pops ONE folder-nav level before falling back to the wizard step.
  type Exposed = { canStepBack: () => boolean; stepBack: () => void }

  async function openTreeExposed() {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="open-tree-btn"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('canStepBack() is false on the quick list, true in the tree view', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    const vm = wrapper.vm as unknown as Exposed
    expect(vm.canStepBack()).toBe(false)
    await wrapper.find('[data-testid="open-tree-btn"]').trigger('click')
    await flushPromises()
    expect(vm.canStepBack()).toBe(true)
  })

  it('stepBack() at the tree root returns to the quick list', async () => {
    const wrapper = await openTreeExposed()
    const vm = wrapper.vm as unknown as Exposed
    expect(vm.canStepBack()).toBe(true)
    vm.stepBack()
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
    expect(vm.canStepBack()).toBe(false)
  })

  it('stepBack() pops ONE breadcrumb level, then drops to quick list at the root', async () => {
    const wrapper = await openTreeExposed()
    const vm = wrapper.vm as unknown as Exposed
    // Drill into a folder → there is now one crumb.
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="crumb"]').exists()).toBe(true)

    // First stepBack: pop the crumb → tree root (still tree, no crumb).
    vm.stepBack()
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="crumb"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(false)

    // Second stepBack: tree root → quick list.
    expect(vm.canStepBack()).toBe(true)
    vm.stepBack()
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(true)
  })
})

describe('FolderPicker — empty default share', () => {
  it('falls through to the tree when /video is empty and there are no recents', async () => {
    globalThis.fetch = ((url: string) => {
      const path = pathFromUrl(url as string)
      // /video (and any drill) empty; share root has one folder.
      if (path !== null) return Promise.resolve(jsonResponse({ folders: [] }))
      return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
    }) as typeof fetch
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="folder-tiles"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="folder-item"]').exists()).toBe(true)
  })
})
