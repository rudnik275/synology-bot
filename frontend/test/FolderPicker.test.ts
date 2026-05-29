// Tests for FolderPicker component (#63).
// Mocks globalThis.fetch to serve /api/folders responses.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import FolderPicker from '../src/components/FolderPicker.vue'

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
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
})

describe('FolderPicker', () => {
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

    // Click the first folder item (downloads) to drill in
    const folderBtns = wrapper.findAll('[data-testid="folder-item"]')
    expect(folderBtns.length).toBeGreaterThan(0)
    await folderBtns[0]!.trigger('click')
    await flushPromises()

    // Should now show children
    expect(wrapper.text()).toContain('torrents')
  })

  it('emits update:modelValue when "Pick this folder" is clicked', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    const pickBtn = wrapper.find('[data-testid="pick-btn"]')
    expect(pickBtn.exists()).toBe(true)
    await pickBtn.trigger('click')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBeTruthy() // some path was emitted
  })

  it('shows a back/up affordance after drilling in', async () => {
    const wrapper = mount(FolderPicker, { props: { modelValue: '' } })
    await flushPromises()

    // Initially no up button (at root)
    expect(wrapper.find('[data-testid="up-btn"]').exists()).toBe(false)

    // Drill in
    await wrapper.findAll('[data-testid="folder-item"]')[0]!.trigger('click')
    await flushPromises()

    // Now up button should exist
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
