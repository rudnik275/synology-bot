// Tests for the search-only AddFlow wizard (ADR 0008, #120).
// FAB → fullscreen Sheet → 3-step wizard: Search → Folder → Confirm.
// The source-chooser step, magnet input, and .torrent upload were removed;
// those sources now arrive via the bot handoff (see AddFlow.torrent.test.ts).
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

const SEARCH_RESULTS = [
  {
    id: 'r1',
    title: 'Movie One',
    size: '2.1 GB',
    seeders: 10,
    leechers: 2,
    downloadUrl: 'https://example.com/movie1.torrent',
    category: 'movies',
  },
]

// Track captured fetch calls for assertion
let fetchCalls: Array<{ url: string; init?: RequestInit }> = []

beforeEach(() => {
  fetchCalls = []
  localStorage.clear()
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    if ((url as string).includes('/api/folders')) {
      return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
    }
    if ((url as string).includes('/api/search')) {
      return Promise.resolve(jsonResponse({ results: SEARCH_RESULTS }))
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
  localStorage.clear()
})

/** Open the wizard via the FAB. */
async function openWizard() {
  const wrapper = mount(AddFlow)
  await wrapper.find('button.fab').trigger('click')
  await flushPromises()
  return wrapper
}

/** Run a search and select the first result so Next is enabled (step 1). */
async function searchAndSelect() {
  const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
  queryInput.value = 'Movie'
  queryInput.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click()
  await flushPromises()
}

/**
 * Pick a folder in the Variant D FolderPicker (no localStorage history).
 * No-history path → tree is shown directly at root. Drill into the first
 * folder-item, then click "Сохранить сюда" (pick-btn) to emit the path.
 */
async function pickFolderInTree() {
  // Drill into the first root folder
  document.querySelector<HTMLButtonElement>('[data-testid="folder-item"]')!.click()
  await flushPromises()
  // Now inside the folder — pick-btn appears
  document.querySelector<HTMLButtonElement>('[data-testid="pick-btn"]')!.click()
  await flushPromises()
}

describe('AddFlow (search-only)', () => {
  // ─── Basic rendering ────────────────────────────────────────────────
  it('renders a FAB button', () => {
    const wrapper = mount(AddFlow)
    expect(wrapper.find('button.fab').exists()).toBe(true)
    wrapper.unmount()
  })

  it('FAB opens the wizard directly into Search — no source chooser', async () => {
    const wrapper = await openWizard()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    // Search is the first/primary step.
    expect(dialog.querySelector('[data-testid="search-query"]')).not.toBeNull()
    expect(dialog.querySelector('[data-testid="search-btn"]')).not.toBeNull()
    // The removed source-chooser cards are gone.
    expect(dialog.querySelector('[data-testid="mode-search"]')).toBeNull()
    expect(dialog.querySelector('[data-testid="mode-magnet"]')).toBeNull()
    expect(dialog.querySelector('[data-testid="mode-torrent"]')).toBeNull()
    // And the removed in-wizard inputs are gone.
    expect(dialog.querySelector('[data-testid="magnet-input"]')).toBeNull()
    expect(dialog.querySelector('[data-testid="torrent-input"]')).toBeNull()
    wrapper.unmount()
  })

  it('step 1 (Search): no Back button on the first step', async () => {
    const wrapper = await openWizard()
    expect(document.querySelector('[data-testid="wizard-back"]')).toBeNull()
    wrapper.unmount()
  })

  it('step 1 (Search): Next is disabled until a result is selected', async () => {
    const wrapper = await openWizard()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)
    await searchAndSelect()
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // ─── Search results rendering ────────────────────────────────────────────────
  it('renders search results with title, size, seeders, leechers, category', async () => {
    const wrapper = await openWizard()
    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    expect(document.querySelector('[data-testid="result-r1"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="result-title"]')!.textContent).toContain('Movie One')
    expect(document.querySelector('[data-testid="result-size"]')!.textContent).toContain('2.1 GB')
    expect(document.querySelector('[data-testid="result-seeders"]')!.textContent).toContain('10')
    wrapper.unmount()
  })

  it('shows loading then "Ничего не найдено" for empty results', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = await openWizard()
    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'nope'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const emptyEl = document.querySelector('[data-testid="search-empty"]')
    expect(emptyEl).not.toBeNull()
    expect(emptyEl!.textContent).toContain('Ничего не найдено')
    wrapper.unmount()
  })

  it('shows an error message when /api/search fails', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ error: 'search failed' }, 500))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = await openWizard()
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

  // ─── Step 2: Folder ────────────────────────────────────────────────
  it('step 2 (Folder): shows FolderPicker (tree mode — no history); Next disabled until a folder is picked', async () => {
    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Variant D with no history: tree is shown directly (no tiles)
    expect(document.querySelector('[data-testid="folder-item"]')).not.toBeNull()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Drill into a folder, then pick it
    await pickFolderInTree()
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // ─── Step 3: Confirm + create ────────────────────────────────────────────────
  it('search happy path: Search → Folder → Confirm posts the result downloadUrl', async () => {
    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // Variant D: drill in, then pick
    await pickFolderInTree()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn).not.toBeNull()
    expect(createBtn.textContent).toMatch(/add/i)
    createBtn.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    expect(taskCall!.init?.method).toBe('POST')
    const body = JSON.parse(taskCall!.init?.body as string)
    expect(body.uri).toBe('https://example.com/movie1.torrent')
    expect(body.destination).toBeTruthy()
    wrapper.unmount()
  })

  it('successful create closes the sheet', async () => {
    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    await pickFolderInTree()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('shows an error message on a 400 create response', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      if ((url as string).includes('/api/search')) return Promise.resolve(jsonResponse({ results: SEARCH_RESULTS }))
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ error: 'destination is required' }, 400))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    await pickFolderInTree()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('destination is required')
    wrapper.unmount()
  })

  // ─── Navigation ────────────────────────────────────────────────
  it('Back from Folder returns to Search and preserves the selected result', async () => {
    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // On Folder now — go Back.
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-back"]')!.click()
    await flushPromises()

    // Back on Search; result still selected (Next enabled without re-selecting).
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  it('reopening the wizard resets to the Search step', async () => {
    const wrapper = await openWizard()
    await searchAndSelect()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    // Now on Folder — Variant D: tree shown (no history), folder-item present.
    expect(document.querySelector('[data-testid="folder-item"]')).not.toBeNull()

    const closeBtn = document.querySelector('.sheet-close') as HTMLButtonElement
    closeBtn?.click()
    await flushPromises()

    await wrapper.find('button.fab').trigger('click')
    await flushPromises()

    // Back at Search, nothing selected.
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    // On the search step there is no pick-btn and no folder-item.
    expect(document.querySelector('[data-testid="pick-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="folder-item"]')).toBeNull()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)
    wrapper.unmount()
  })

  // ─── Search history (#98) — lives on the Search step ────────────────────────────
  const HISTORY_KEY = 'nas-bot:search-history'

  it('records a successful search query into history', async () => {
    const wrapper = await openWizard()
    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Sopranos'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(stored).toContain('Sopranos')
    wrapper.unmount()
  })

  it('focusing the search input shows the history dropdown with prior queries', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Lost', 'Dexter']))
    const wrapper = await openWizard()

    expect(document.querySelector('[data-testid="search-history"]')).toBeNull()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    expect(document.querySelector('[data-testid="search-history"]')).not.toBeNull()
    const items = document.querySelectorAll('[data-testid="history-item"]')
    expect(items.length).toBe(2)
    expect(items[0]?.textContent?.trim()).toBe('Lost')
    wrapper.unmount()
  })

  it('clicking a history item sets the query and triggers a search', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Movie']))
    const wrapper = await openWizard()

    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    const historyItem = document.querySelector('[data-testid="history-item"]') as HTMLElement
    historyItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    historyItem.click()
    await flushPromises()

    const updatedInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    expect(updatedInput.value).toBe('Movie')
    expect(document.querySelector('[data-testid="result-r1"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('closing + reopening the wizard does NOT wipe search history', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Succession']))
    const wrapper = await openWizard()

    const closeBtn = document.querySelector('.sheet-close') as HTMLButtonElement
    closeBtn?.click()
    await flushPromises()

    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    expect(stored).toContain('Succession')
    wrapper.unmount()
  })
})
