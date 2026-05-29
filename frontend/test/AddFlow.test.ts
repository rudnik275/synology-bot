// Tests for AddFlow component (#63): FAB → Sheet → mode switcher → FolderPicker → create.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import AddFlow from '../src/components/AddFlow.vue'

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Track captured fetch calls for assertion
let fetchCalls: Array<{ url: string; init?: RequestInit }> = []

beforeEach(() => {
  fetchCalls = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    if ((url as string) === '/api/folders' || (url as string).includes('/api/folders')) {
      return Promise.resolve(
        jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] })
      )
    }
    if ((url as string) === '/api/tasks') {
      return Promise.resolve(jsonResponse({ ok: true }, 201))
    }
    return Promise.resolve(jsonResponse({ folders: [] }))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
})

describe('AddFlow', () => {
  it('renders a FAB button', () => {
    const wrapper = mount(AddFlow)
    expect(wrapper.find('button.fab').exists()).toBe(true)
  })

  it('opens the sheet when FAB is clicked', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()
    // Sheet teleports to body; check document
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    wrapper.unmount()
  })

  it('shows magnet input in magnet mode (default)', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    // Magnet mode should be active — there should be a text input
    const magnetInput = dialog.querySelector('[data-testid="magnet-input"]')
    expect(magnetInput).not.toBeNull()
    wrapper.unmount()
  })

  it('shows file input when .torrent mode is selected', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Click the .torrent mode button
    const modeBtn = document.querySelector('[data-testid="mode-torrent"]') as HTMLButtonElement
    expect(modeBtn).not.toBeNull()
    modeBtn.click()
    await flushPromises()

    const fileInput = document.querySelector('[data-testid="torrent-input"]')
    expect(fileInput).not.toBeNull()
    wrapper.unmount()
  })

  it('has a disabled "search" mode button labeled "soon"', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const searchBtn = document.querySelector('[data-testid="mode-search"]') as HTMLButtonElement
    expect(searchBtn).not.toBeNull()
    expect(searchBtn.disabled).toBe(true)
    wrapper.unmount()
  })

  it('posts JSON with uri+destination for magnet create', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Fill magnet input
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLInputElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Folder picker is rendered — pick the available folder
    await flushPromises()
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }

    // Submit
    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn).not.toBeNull()
    createBtn.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    expect(taskCall!.init?.method).toBe('POST')
    // Should be JSON, not multipart
    const contentType = (taskCall!.init?.headers as Record<string, string>)['Content-Type']
    expect(contentType).toContain('application/json')
    const parsed = JSON.parse(taskCall!.init?.body as string)
    expect(parsed.uri).toBe('magnet:?xt=urn:btih:abc123')
    expect(parsed.destination).toBeTruthy()
    wrapper.unmount()
  })

  it('posts multipart FormData for .torrent create', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Switch to .torrent mode
    const modeBtn = document.querySelector('[data-testid="mode-torrent"]') as HTMLButtonElement
    modeBtn.click()
    await flushPromises()

    // Pick a folder
    await flushPromises()
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }

    // Simulate file selection by triggering a change event on the file input
    const fileInput = document.querySelector('[data-testid="torrent-input"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    const testFile = new File(['torrent-content'], 'test.torrent', { type: 'application/x-bittorrent' })
    // Set the files property on the input (requires Object.defineProperty in happy-dom)
    Object.defineProperty(fileInput, 'files', {
      value: { 0: testFile, length: 1, item: (i: number) => i === 0 ? testFile : null },
      configurable: true,
    })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn).not.toBeNull()
    createBtn.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    // Should NOT have Content-Type set (multipart boundary set by browser)
    const headers = (taskCall!.init?.headers as Record<string, string>) ?? {}
    expect(headers['Content-Type']).toBeUndefined()
    // Body should be FormData
    expect(taskCall!.init?.body).toBeInstanceOf(FormData)
    wrapper.unmount()
  })

  it('shows an error message on 400 response', async () => {
    globalThis.fetch = ((url: string) => {
      if ((url as string).includes('/api/folders')) {
        return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      }
      if ((url as string) === '/api/tasks') {
        return Promise.resolve(jsonResponse({ error: 'destination is required' }, 400))
      }
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Type a magnet URI
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLInputElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Pick a folder so we can submit
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }

    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    createBtn.click()
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('destination is required')
    wrapper.unmount()
  })

  it('closes the sheet on successful create', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLInputElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }

    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    createBtn.click()
    await flushPromises()

    // Sheet should be closed after success
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })
})
