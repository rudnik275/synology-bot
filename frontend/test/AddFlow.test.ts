// Tests for the search-only AddFlow wizard (ADR 0008, #120, #118).
// Inline add-row → fullscreen Sheet → 3-step wizard: Search → Folder → Confirm.
// The floating FAB was removed in #118; the wizard is now opened via openSheet()
// exposed by AddFlow (called by the inline row in DownloadsTab).
// The source-chooser step, magnet input, and .torrent upload were removed;
// those sources now arrive via the bot handoff (see AddFlow.torrent.test.ts).
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import AddFlow from '../src/components/AddFlow.vue'
import { useOptimisticTasks } from '../src/composables/useOptimisticTasks'

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
    if ((url as string).includes('/api/tasks/inspect')) {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ ok: true }))
      if (init?.method === 'POST') return Promise.resolve(jsonResponse({ listId: 'btdlTEST' }, 201))
      // GET poll — file tree ready immediately.
      return Promise.resolve(jsonResponse({
        ready: true,
        title: 'Movie One',
        size: 2_050_000_000,
        files: [
          { index: 0, name: 'Movie One/movie.mkv', size: 2_000_000_000 },
          { index: 1, name: 'Movie One/sample.mkv', size: 50_000_000 },
        ],
      }))
    }
    if ((url as string).includes('/api/tasks/commit')) {
      return Promise.resolve(jsonResponse({ ok: true }, 201))
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

/**
 * Open the wizard via the exposed openSheet() method (#118).
 * The FAB was removed; the inline add-row in DownloadsTab calls openSheet().
 * In unit tests that mount AddFlow directly, call it on the vm.
 */
async function openWizard() {
  const wrapper = mount(AddFlow)
  // AddFlow exposes openSheet() so DownloadsTab (and tests) can call it.
  ;(wrapper.vm as unknown as { openSheet: () => void }).openSheet()
  await flushPromises()
  return wrapper
}

/**
 * Run a search and tap the first result — tapping a result selects it AND
 * advances straight to the Folder step in one tap (#121 tap-to-advance).
 * After this helper the wizard is on step 2 (Folder).
 */
async function searchAndSelect() {
  const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
  queryInput.value = 'Movie'
  queryInput.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
  await flushPromises()
  // Tapping the result row selects the result AND advances to Folder (#121).
  document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click()
  await flushPromises()
  // Wizard is now on step 2 (Folder) — no wizard-next click needed.
}

/**
 * Pick a folder in the quick-list FolderPicker (#2). The destination step opens
 * on the flat quick list (seeded from /video's subfolders + recents — the fetch
 * mock returns one folder, so one tile shows). Tapping the tile selects it as
 * the destination; the footer "Далее" then advances.
 */
async function pickFolderInTree() {
  document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
  await flushPromises()
}

describe('AddFlow (search-only)', () => {
  // ─── Basic rendering ────────────────────────────────────────────────
  it('does NOT render a floating FAB button (#118: FAB removed, inline row in DownloadsTab)', () => {
    const wrapper = mount(AddFlow)
    expect(wrapper.find('button.fab').exists()).toBe(false)
    wrapper.unmount()
  })

  it('openSheet() opens the wizard directly into Search — no source chooser (#118)', async () => {
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

  it('step 1 (Search): no Next button on the search step — result tap advances (#121)', async () => {
    const wrapper = await openWizard()
    // The search step has no Далее/Next button — row tap IS the advance.
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()
    // After tapping a result the wizard advances straight to the Folder step.
    await searchAndSelect()
    // Now on step 2 (Folder): quick folder list is visible, Next button appears.
    expect(document.querySelector('[data-testid="folder-tile"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).not.toBeNull()
    wrapper.unmount()
  })

  // ─── Search results rendering ────────────────────────────────────────────────
  it('renders search results: grouped card, title, seeders (health), size, chevron (#121)', async () => {
    const wrapper = await openWizard()
    const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    queryInput.value = 'Movie'
    queryInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()

    // One grouped card, not N separate boxes.
    const resultsContainer = document.querySelector('[data-testid="search-results"]')!
    expect(resultsContainer).not.toBeNull()
    const rows = resultsContainer.querySelectorAll('[data-testid="result-r1"]')
    expect(rows.length).toBe(1)

    // Row content: title, seeders (health indicator), size.
    expect(document.querySelector('[data-testid="result-title"]')!.textContent).toContain('Movie One')
    expect(document.querySelector('[data-testid="result-seeders"]')!.textContent).toContain('10')
    expect(document.querySelector('[data-testid="result-size"]')!.textContent).toContain('2.1 GB')
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
  it('step 2 (Folder): shows the quick folder list; Next disabled until a folder is picked', async () => {
    const wrapper = await openWizard()
    // searchAndSelect() taps a result — auto-advances to Folder step (#121).
    await searchAndSelect()

    // #2: quick list is shown (seeded from /video subfolders); a tile is present.
    expect(document.querySelector('[data-testid="folder-tile"]')).not.toBeNull()
    const nextBtn = document.querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    // Pick a quick folder
    await pickFolderInTree()
    expect(nextBtn.disabled).toBe(false)
    wrapper.unmount()
  })

  // ─── Step 3: Confirm + create (auto-inspect → commit subset, #123) ──────────
  // Reaching Confirm auto-inspects (the mock returns a 2-file tree, all ticked),
  // so «Добавить» commits the selected subset. Detailed tree behaviour lives in
  // AddFlow.confirm.test.ts.
  async function reachConfirm() {
    await searchAndSelect()
    await pickFolderInTree()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    await flushPromises() // let the auto-inspect poll resolve to 'ready'
  }

  it('search happy path: inspects with the downloadUrl, then commits the subset', async () => {
    const wrapper = await openWizard()
    await reachConfirm()

    const inspectCall = fetchCalls.find((c) => c.url === '/api/tasks/inspect' && c.init?.method === 'POST')
    expect(inspectCall).toBeTruthy()
    expect(JSON.parse(inspectCall!.init?.body as string).uri).toBe('https://example.com/movie1.torrent')

    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn.textContent).toMatch(/добавить/i)
    createBtn.click()
    await flushPromises()

    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    const body = JSON.parse(commit!.init?.body as string)
    expect(body.listId).toBe('btdlTEST')
    expect(body.selected).toEqual([0, 1]) // all files ticked by default
    expect(body.destination).toBeTruthy()
    wrapper.unmount()
  })

  it('successful create closes the sheet', async () => {
    const wrapper = await openWizard()
    await reachConfirm()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('rolls back the optimistic placeholder when the commit fails (#161 fully-optimistic)', async () => {
    // Fully-optimistic commit (#161): «Добавить» closes the sheet INSTANTLY and the
    // commit runs in the background, so a failure can't be shown in the (now closed)
    // sheet — instead it rolls back the optimistic placeholder. The commit itself is
    // still attempted with the correct listId (commit-correctness preserved).
    const optimistic = useOptimisticTasks()
    const wrapper = await openWizard()
    await reachConfirm()
    // Make the commit fail.
    const prev = globalThis.fetch
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string) === '/api/tasks/commit') return Promise.resolve(jsonResponse({ error: 'destination is required' }, 400))
      return (prev as typeof fetch)(url as string, init)
    }) as typeof fetch
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Sheet closed immediately (optimistic) …
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // … the commit was still attempted with the inspected listId …
    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    expect(JSON.parse(commit!.init?.body as string).listId).toBe('btdlTEST')
    // … and the failed add rolled the placeholder back out of the Downloads list.
    expect(optimistic.pendingTasks()).toHaveLength(0)
    wrapper.unmount()
  })

  // ─── Navigation ────────────────────────────────────────────────
  it('Back from Folder returns to Search; re-tapping a result re-advances (#121)', async () => {
    // #5: "Назад" is the native Telegram BackButton now, not an in-sheet button.
    // Install a fake that captures the click handler so we can drive it.
    let backHandler: (() => void) | null = null
    ;(window as unknown as { Telegram?: unknown }).Telegram = {
      WebApp: {
        BackButton: {
          show() {},
          hide() {},
          onClick(cb: () => void) { backHandler = cb },
          offClick() {},
        },
      },
    }
    const wrapper = await openWizard()
    // searchAndSelect() taps a result — auto-advances to Folder (#121), which
    // shows the BackButton and captures its handler.
    await searchAndSelect()

    // On Folder now — drive the Telegram BackButton.
    expect(backHandler).not.toBeNull()
    backHandler!()
    await flushPromises()

    // Back on Search; search input visible; no Next button on this step.
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()
    ;(window as unknown as { Telegram?: unknown }).Telegram = undefined
    wrapper.unmount()
  })

  it('reopening the wizard resets to the Search step', async () => {
    const wrapper = await openWizard()
    // searchAndSelect() taps a result — auto-advances to Folder (#121).
    await searchAndSelect()
    // Now on Folder — quick list shown (#2), folder-tile present.
    expect(document.querySelector('[data-testid="folder-tile"]')).not.toBeNull()

    const closeBtn = document.querySelector('.sheet-close') as HTMLButtonElement
    closeBtn?.click()
    await flushPromises()

    // Re-open via exposed openSheet() (inline row in DownloadsTab calls this, #118)
    ;(wrapper.vm as unknown as { openSheet: () => void }).openSheet()
    await flushPromises()

    // Back at Search, nothing selected.
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    // On the search step there is no pick-btn, no folder-item, and no Next button.
    expect(document.querySelector('[data-testid="pick-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="folder-item"]')).toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()
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

  // ─── Stepper frame (#119) ──────────────────────────────────────────────────
  it('stepper renders 3 circles on the search path (Поиск · Папка · Готово)', async () => {
    const wrapper = await openWizard()
    const stepper = document.querySelector('[data-testid="stepper"]')!
    expect(stepper).not.toBeNull()
    const circles = stepper.querySelectorAll('.stepper-circle')
    expect(circles.length).toBe(3)
    const labels = Array.from(stepper.querySelectorAll('.stepper-label')).map((el) => el.textContent?.trim())
    expect(labels).toEqual(['Поиск', 'Папка', 'Готово'])
    wrapper.unmount()
  })

  it('stepper marks step 1 as current and steps 2–3 as future on open', async () => {
    const wrapper = await openWizard()
    const stepper = document.querySelector('[data-testid="stepper"]')!
    const circles = stepper.querySelectorAll('.stepper-circle')
    expect(circles[0]?.classList.contains('stepper-circle--current')).toBe(true)
    expect(circles[1]?.classList.contains('stepper-circle--current')).toBe(false)
    expect(circles[2]?.classList.contains('stepper-circle--current')).toBe(false)
    wrapper.unmount()
  })

  it('stepper marks step 1 as done and step 2 as current after tapping a result (#121)', async () => {
    const wrapper = await openWizard()
    // searchAndSelect() taps a result — auto-advances to Folder (#121).
    // No wizard-next click needed; the tap is the advance.
    await searchAndSelect()

    const stepper = document.querySelector('[data-testid="stepper"]')!
    const circles = stepper.querySelectorAll('.stepper-circle')
    expect(circles[0]?.classList.contains('stepper-circle--done')).toBe(true)
    expect(circles[1]?.classList.contains('stepper-circle--current')).toBe(true)
    expect(circles[2]?.classList.contains('stepper-circle--current')).toBe(false)
    wrapper.unmount()
  })

  it('Add button appears on step 3 (last step of search path) (#121)', async () => {
    const wrapper = await openWizard()
    // Step 1 — no Add button, no Next button (search step has neither; tap advances).
    expect(document.querySelector('[data-testid="create-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()

    // searchAndSelect() taps a result — auto-advances to Folder (#121).
    await searchAndSelect()
    // Step 2 — Next appears, no Add.
    expect(document.querySelector('[data-testid="create-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).not.toBeNull()

    await pickFolderInTree()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    // Step 3 — Add appears, Next gone.
    expect(document.querySelector('[data-testid="create-btn"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()
    wrapper.unmount()
  })
})
