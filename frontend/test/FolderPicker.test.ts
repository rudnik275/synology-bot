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

describe('FolderPicker — favorites (#306)', () => {
  it('renders pinned folders in an «Избранное» group above the quick rows', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/volume1/fav']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Избранное')
    const favs = wrapper.findAll('[data-testid="favorite-tile"]')
    expect(favs).toHaveLength(1)
    expect(favs[0]!.text()).toContain('fav')
    // The favorites group sits ABOVE the quick rows.
    const html = wrapper.html()
    expect(html.indexOf('favorite-tiles')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('favorite-tiles')).toBeLessThan(html.indexOf('folder-tiles'))
  })

  it('excludes favorited paths from the quick list (no duplicate rows, cap untouched)', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/video/сериалы']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    // /video/сериалы lives in the favorites group only; the quick list keeps /video/новое.
    expect(wrapper.findAll('[data-testid="favorite-tile"]')).toHaveLength(1)
    const quick = wrapper.findAll('[data-testid="folder-tile"]')
    expect(quick).toHaveLength(1)
    expect(quick[0]!.text()).toContain('новое')
  })

  it('tapping a favorite row emits update:modelValue', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/volume1/fav']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="favorite-tile"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted![0]![0]).toBe('/volume1/fav')
  })

  it('the pin button on a quick row pins it into the favorites group + localStorage', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="favorite-tiles"]').exists()).toBe(false)
    // First quick row is /video/сериалы — pin it.
    await wrapper.find('[data-testid="pin-btn"]').trigger('click')
    expect(localStorage.getItem(LS_FAVORITES)).toBe(JSON.stringify(['/video/сериалы']))
    expect(wrapper.find('[data-testid="favorite-tiles"]').text()).toContain('сериалы')
    // The pinned path left the quick list (no duplicate).
    const quick = wrapper.findAll('[data-testid="folder-tile"]')
    expect(quick.map((t) => t.text()).join(' ')).not.toContain('сериалы')
  })

  it('pinning a row must NOT select it (pin click does not emit update:modelValue)', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="pin-btn"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('the pin button in the favorites group unpins (row returns to the quick list)', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/video/сериалы']))
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    // The favorites group's pin button comes first in DOM order.
    await wrapper.find('[data-testid="favorite-tiles"] [data-testid="pin-btn"]').trigger('click')
    expect(localStorage.getItem(LS_FAVORITES)).toBe(JSON.stringify([]))
    expect(wrapper.find('[data-testid="favorite-tiles"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="folder-tile"]')).toHaveLength(2)
  })

  it('tree rows carry a pin button that toggles favorites', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    await wrapper.find('[data-testid="open-tree-btn"]').trigger('click')
    await flushPromises()
    // Pin the first share (/volume1/downloads) from the tree.
    await wrapper.find('[data-testid="folder-item"] ~ [data-testid="pin-btn"]').trigger('click')
    expect(localStorage.getItem(LS_FAVORITES)).toBe(JSON.stringify(['/volume1/downloads']))
  })

  it('stays on the quick view when the default share is empty but favorites exist', async () => {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(['/volume1/fav']))
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ folders: [] }))) as typeof fetch
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="favorite-tiles"]').exists()).toBe(true)
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

  it('has no in-app back-to-folders button — native Back drives it (round-2)', async () => {
    const wrapper = await openTree()
    // The «Папки» control was removed: the native Telegram Back returns to the
    // quick list (via the exposed stepBack(), covered in the nav describe below).
    expect(wrapper.find('[data-testid="back-to-tiles-btn"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Папки')
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
