// Tests for AddFlow wizard (#95): FAB → fullscreen Sheet → 4-step wizard.
// Step 1: Choose source (Search default, Magnet, Torrent)
// Step 2: Input for selected source
// Step 3: FolderPicker
// Step 4: Confirm summary + Add button
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
  // ─── Basic rendering ────────────────────────────────────────────────
  it('renders a FAB button', () => {
    const wrapper = mount(AddFlow)
    expect(wrapper.find('button.fab').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the fullscreen sheet when FAB is clicked', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    wrapper.unmount()
  })

  // ─── Step 1: Source picker ────────────────────────────────────────────────
  it('step 1: shows source cards — Search selected by default', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    // All three source cards visible
    expect(dialog.querySelector('[data-testid="mode-search"]')).not.toBeNull()
    expect(dialog.querySelector('[data-testid="mode-magnet"]')).not.toBeNull()
    expect(dialog.querySelector('[data-testid="mode-torrent"]')).not.toBeNull()
    // Search is default selected
    const searchCard = dialog.querySelector('[data-testid="mode-search"]') as HTMLElement
    const ariaPressed = searchCard.getAttribute('aria-pressed')
    const isSelected = ariaPressed === 'true' || searchCard.className.includes('selected')
    expect(isSelected).toBe(true)
    wrapper.unmount()
  })

  it('step 1: clicking a source card selects it', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const magnetCard = document.querySelector('[data-testid="mode-magnet"]') as HTMLButtonElement
    magnetCard.click()
    await flushPromises()

    const magnetAriaPressed = magnetCard.getAttribute('aria-pressed')
    const magnetIsSelected = magnetAriaPressed === 'true' || magnetCard.className.includes('selected')
    expect(magnetIsSelected).toBe(true)
    wrapper.unmount()
  })

  it('step 1: Next button advances to step 2', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn).not.toBeNull()
    nextBtn.click()
    await flushPromises()

    // Step 2: search input should appear (search is default)
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('step 1: Next is always enabled (source already selected by default)', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // ─── Step 2: Input ────────────────────────────────────────────────
  it('step 2 magnet: shows magnet input and Next is disabled until value entered', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select magnet
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    // Advance to step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const magnetInput = document.querySelector('[data-testid="magnet-input"]')
    expect(magnetInput).not.toBeNull()

    // Next should be disabled with empty input
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Enter a value
    const inputEl = magnetInput as HTMLTextAreaElement
    inputEl.value = 'magnet:?xt=urn:btih:abc123'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Now Next should be enabled
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  it('step 2 torrent: shows styled file input and Next disabled until file selected', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select torrent
    document.querySelector<HTMLButtonElement>('[data-testid="mode-torrent"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const fileInput = document.querySelector('[data-testid="torrent-input"]')
    expect(fileInput).not.toBeNull()

    // Next should be disabled until file selected
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Simulate file selection
    const testFile = new File(['torrent-content'], 'test.torrent', { type: 'application/x-bittorrent' })
    Object.defineProperty(fileInput, 'files', {
      value: { 0: testFile, length: 1, item: (i: number) => i === 0 ? testFile : null },
      configurable: true,
    })
    fileInput!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  it('step 2 search: shows search input, search button, results; Next disabled until result selected', async () => {
    const searchResults = [
      { id: 'r1', title: 'Movie One', size: '2.1 GB', seeders: 10, leechers: 2, downloadUrl: 'https://example.com/movie1.torrent', category: 'movies' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ ok: true }, 201))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Search is default, advance to step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    expect(queryInput).not.toBeNull()
    const searchBtn = document.querySelector('[data-testid="search-btn"]') as HTMLButtonElement
    expect(searchBtn).not.toBeNull()

    // Next disabled until result selected
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Run search
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    searchBtn.click()
    await flushPromises()

    // Result cards rendered
    expect(document.querySelector('[data-testid="result-r1"]')).not.toBeNull()

    // Still disabled until result is clicked
    expect(nextBtn.disabled).toBe(true)

    // Click result
    document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click()
    await flushPromises()

    // Now Next enabled
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  it('step 2: search shows loading indicator during search', async () => {
    let resolveSearch!: (v: Response) => void
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return new Promise<Response>((res) => { resolveSearch = res })
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Advance to step 2 (search default)
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Test'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await Promise.resolve()

    expect(document.querySelector('[data-testid="search-loading"]')).not.toBeNull()

    resolveSearch(jsonResponse({ results: [] }))
    await flushPromises()

    expect(document.querySelector('[data-testid="search-loading"]')).toBeNull()
    wrapper.unmount()
  })

  it('step 2: search shows "Ничего не найдено" for empty results', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Unknown title'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const emptyEl = document.querySelector('[data-testid="search-empty"]')
    expect(emptyEl).not.toBeNull()
    expect(emptyEl!.textContent).toContain('Ничего не найдено')
    wrapper.unmount()
  })

  it('step 2: search shows error message when /api/search fails', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ error: 'search failed' }, 500))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'query'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const errorEl = document.querySelector('[data-testid="search-error"]')
    expect(errorEl).not.toBeNull()
    expect(errorEl!.textContent).toContain('search failed')
    wrapper.unmount()
  })

  // ─── Step 3: Folder ────────────────────────────────────────────────
  it('step 3: shows FolderPicker; Next disabled until folder picked', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Step 1 → Next (search default)
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Step 2: enter magnet or pick to advance — but we're on search...
    // Let's use magnet instead for a simpler path
    // Actually we need to go back to step 1 first — use Back
    const backBtn = document.querySelector('[data-testid="wizard-back"]') as HTMLButtonElement
    expect(backBtn).not.toBeNull()
    backBtn.click()
    await flushPromises()

    // Now select Magnet
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Step 2: enter magnet
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Now on step 3: folder picker
    expect(document.querySelector('[data-testid="pick-btn"]')).not.toBeNull()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Pick folder
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    pickBtn.click()
    await flushPromises()

    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // ─── Step 4: Confirm ────────────────────────────────────────────────
  it('step 4 (magnet): shows confirm summary with source/destination and Add button', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select Magnet
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Enter magnet
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Pick folder
    document.querySelector<HTMLButtonElement>('[data-testid="pick-btn"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Step 4: confirm
    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn).not.toBeNull()
    expect(createBtn.textContent).toMatch(/add/i)
    wrapper.unmount()
  })

  // ─── Full happy paths ────────────────────────────────────────────────
  it('magnet path: posts JSON with uri+destination for magnet create', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select magnet
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Fill magnet input
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Pick folder
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

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

  it('torrent path: posts multipart FormData for .torrent create', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select torrent
    document.querySelector<HTMLButtonElement>('[data-testid="mode-torrent"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Select file
    const fileInput = document.querySelector('[data-testid="torrent-input"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    const testFile = new File(['torrent-content'], 'test.torrent', { type: 'application/x-bittorrent' })
    Object.defineProperty(fileInput, 'files', {
      value: { 0: testFile, length: 1, item: (i: number) => i === 0 ? testFile : null },
      configurable: true,
    })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Pick folder
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Submit
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

  it('search path: full happy path posts the result downloadUrl', async () => {
    const searchResults = [
      { id: 'r1', title: 'Movie One', size: '2.1 GB', seeders: 10, leechers: 2, downloadUrl: 'https://example.com/movie1.torrent', category: 'movies' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ ok: true }, 201))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Search is default, advance to step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Search
    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    // Pick result
    const resultCard = document.querySelector('[data-testid="result-r1"]') as HTMLButtonElement
    expect(resultCard).not.toBeNull()
    resultCard.click()
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Pick folder
    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Click Add
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    expect(taskCall!.init?.method).toBe('POST')
    const body = JSON.parse(taskCall!.init?.body as string)
    expect(body.uri).toBe('https://example.com/movie1.torrent')
    expect(body.destination).toBeTruthy()
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

    // Go through magnet path to confirm step
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

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

    // Go through magnet path
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Sheet should be closed after success
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('search: success closes the sheet', async () => {
    const searchResults = [
      { id: 'r1', title: 'Movie One', size: '2.1 GB', seeders: 10, leechers: 2, downloadUrl: 'https://example.com/movie1.torrent', category: 'movies' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ ok: true }, 201))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Search default → step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click()
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const pickBtn = document.querySelector('[data-testid="pick-btn"]') as HTMLButtonElement
    if (pickBtn) {
      pickBtn.click()
      await flushPromises()
    }
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Sheet should be closed
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  // ─── Navigation ────────────────────────────────────────────────
  it('Back returns to previous step and preserves input', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Select Magnet in step 1
    document.querySelector<HTMLButtonElement>('[data-testid="mode-magnet"]')!.click()
    await flushPromises()

    // Advance to step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Enter magnet
    const magnetInput = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    magnetInput.value = 'magnet:?xt=urn:btih:abc123'
    magnetInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Go back to step 1
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-back"]')!.click()
    await flushPromises()

    // Still on step 1 — source cards visible
    expect(document.querySelector('[data-testid="mode-magnet"]')).not.toBeNull()

    // Advance to step 2 again
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Input preserved
    const magnetInputAgain = document.querySelector('[data-testid="magnet-input"]') as HTMLTextAreaElement
    expect(magnetInputAgain.value).toBe('magnet:?xt=urn:btih:abc123')
    wrapper.unmount()
  })

  it('reopening the wizard resets to step 1', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Advance to step 2
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()

    // Close the sheet
    const closeBtn = document.querySelector('.sheet-close') as HTMLButtonElement
    if (closeBtn) {
      closeBtn.click()
      await flushPromises()
    }

    // Reopen
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Should be back at step 1 with source cards
    expect(document.querySelector('[data-testid="mode-search"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="search-query"]')).toBeNull()
    wrapper.unmount()
  })

  it('step 1: no Back button on first step', async () => {
    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // On step 1, Back should not exist or be hidden
    const backBtn = document.querySelector('[data-testid="wizard-back"]')
    expect(!backBtn || (backBtn as HTMLButtonElement).disabled || backBtn.getAttribute('style')?.includes('display: none') || backBtn.hasAttribute('hidden')).toBe(true)
    wrapper.unmount()
  })

  it('result cards render title, size, seeders, leechers, category', async () => {
    const searchResults = [
      { id: 'r1', title: 'Movie One', size: '2.1 GB', seeders: 10, leechers: 2, downloadUrl: 'https://example.com/movie1.torrent', category: 'movies' },
      { id: 'r2', title: 'Movie Two', size: '1.5 GB', seeders: 5, leechers: 1, downloadUrl: 'https://example.com/movie2.torrent', category: 'movies' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ ok: true }, 201))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Advance to step 2 (search default)
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const resultCards = document.querySelectorAll('.result-card')
    expect(resultCards.length).toBe(2)

    const titles = document.querySelectorAll('[data-testid="result-title"]')
    expect(titles[0]?.textContent).toContain('Movie One')
    expect(titles[1]?.textContent).toContain('Movie Two')

    const sizes = document.querySelectorAll('[data-testid="result-size"]')
    expect(sizes[0]?.textContent).toContain('2.1 GB')

    const seeders = document.querySelectorAll('[data-testid="result-seeders"]')
    expect(seeders[0]?.textContent).toContain('10')

    wrapper.unmount()
  })

  // ─── Search history (#98) ────────────────────────────────────────────────
  const HISTORY_KEY = 'nas-bot:search-history'

  function clearSearchHistory() {
    localStorage.removeItem(HISTORY_KEY)
  }

  it('search: successful search records the query into history', async () => {
    clearSearchHistory()
    const searchResults = [
      { id: 'r1', title: 'Sopranos S1', size: '2 GB', seeders: 5, leechers: 1, downloadUrl: 'https://example.com/s1.torrent', category: 'tv' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Sopranos'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(stored).toContain('Sopranos')

    clearSearchHistory()
    wrapper.unmount()
  })

  it('search: focusing the search input shows the history dropdown with prior queries', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Lost', 'Dexter']))
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Dropdown should not be visible before focus
    expect(document.querySelector('[data-testid="search-history"]')).toBeNull()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    const dropdown = document.querySelector('[data-testid="search-history"]')
    expect(dropdown).not.toBeNull()

    const items = document.querySelectorAll('[data-testid="history-item"]')
    expect(items.length).toBe(2)
    expect(items[0]?.textContent?.trim()).toBe('Lost')
    expect(items[1]?.textContent?.trim()).toBe('Dexter')

    clearSearchHistory()
    wrapper.unmount()
  })

  it('search: typing filters the history dropdown to matching items', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Breaking Bad', 'Better Call Saul', 'Lost']))

    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    // Type 'break' — should filter to 'Breaking Bad' only
    queryInput.value = 'break'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const items = document.querySelectorAll('[data-testid="history-item"]')
    expect(items.length).toBe(1)
    expect(items[0]?.textContent?.trim()).toBe('Breaking Bad')

    clearSearchHistory()
    wrapper.unmount()
  })

  it('search: clicking a history item sets the query and triggers search', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['House M.D.']))
    const searchResults = [
      { id: 'h1', title: 'House M.D. S01', size: '1 GB', seeders: 8, leechers: 1, downloadUrl: 'https://example.com/house.torrent', category: 'tv' },
    ]
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: searchResults }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    const historyItem = document.querySelector('[data-testid="history-item"]') as HTMLElement
    expect(historyItem).not.toBeNull()

    // Use mousedown.prevent pattern (prevents blur before click)
    historyItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    historyItem.click()
    await flushPromises()

    // The query input should now have the history item's text
    const updatedInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    expect(updatedInput.value).toBe('House M.D.')

    // And search results should appear (search was triggered)
    expect(document.querySelector('[data-testid="result-h1"]')).not.toBeNull()

    clearSearchHistory()
    wrapper.unmount()
  })

  it('search: "Clear history" affordance empties the dropdown', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Mindhunter', 'Ozark']))

    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    // Dropdown visible with 2 items
    expect(document.querySelectorAll('[data-testid="history-item"]').length).toBe(2)

    const clearBtn = document.querySelector('[data-testid="search-history-clear"]') as HTMLElement
    expect(clearBtn).not.toBeNull()
    clearBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    clearBtn.click()
    await flushPromises()

    // Items should be gone
    expect(document.querySelectorAll('[data-testid="history-item"]').length).toBe(0)
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()

    clearSearchHistory()
    wrapper.unmount()
  })

  it('resetForm (close + reopen wizard) does NOT wipe search history', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Succession']))

    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow)
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Close the sheet (triggers resetForm)
    const closeBtn = document.querySelector('.sheet-close') as HTMLButtonElement
    if (closeBtn) {
      closeBtn.click()
      await flushPromises()
    }

    // History key must still exist in localStorage
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(stored).toContain('Succession')

    // Reopen and go to step 2 — history should still be accessible
    await wrapper.find('button.fab').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    const items = document.querySelectorAll('[data-testid="history-item"]')
    expect(items.length).toBe(1)
    expect(items[0]?.textContent?.trim()).toBe('Succession')

    clearSearchHistory()
    wrapper.unmount()
  })
})
