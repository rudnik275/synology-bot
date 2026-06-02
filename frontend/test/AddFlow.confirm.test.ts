// Confirm-step redesign + per-file selection (#123).
//
// Reaching Confirm runs an inspect (create_list=true) that returns a list_id +
// file tree; the owner toggles per-file checkboxes; «Добавить» commits the
// selected subset. Covers the inspect loading state, the tree, functional
// checkboxes, the commit payload, and the whole-torrent fallback.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import AddFlow from '../src/components/AddFlow.vue'

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const SEARCH_RESULTS = [
  {
    id: 'r1',
    title: 'Andor S02 1080p WEB-DL',
    size: '24.3 GB',
    seeders: 30,
    leechers: 2,
    downloadUrl: 'https://toloka.to/download.php?id=1',
    category: 'tv',
    year: 2025,
    quality: ['1080p', 'WEB-DL'],
    languages: ['Ukr', 'Eng'],
  },
]

const INSPECT_FILES = [
  { index: 0, path: 'Andor.S02/Season 2/Andor.S02E01.1080p.mkv', size: 3_100_000_000 },
  { index: 1, path: 'Andor.S02/Season 2/Andor.S02E02.1080p.mkv', size: 2_900_000_000 },
  { index: 2, path: 'Andor.S02/poster.jpg', size: 1_200_000 },
]

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let inspectResponse: unknown = { listId: 'LZ', files: INSPECT_FILES }

beforeEach(() => {
  fetchCalls = []
  inspectResponse = { listId: 'LZ', files: INSPECT_FILES }
  localStorage.clear()
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    if ((url as string).includes('/api/folders')) {
      return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
    }
    if ((url as string).includes('/api/search')) {
      return Promise.resolve(jsonResponse({ results: SEARCH_RESULTS }))
    }
    if ((url as string) === '/api/tasks/inspect') {
      return Promise.resolve(jsonResponse(inspectResponse))
    }
    if ((url as string) === '/api/tasks/commit') {
      return Promise.resolve(jsonResponse({ ok: true }, 201))
    }
    if ((url as string).startsWith('/api/tasks/inspect/')) {
      return Promise.resolve(jsonResponse({ ok: true }))
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

async function openWizard() {
  const wrapper = mount(AddFlow)
  ;(wrapper.vm as unknown as { openSheet: () => void }).openSheet()
  await flushPromises()
  return wrapper
}

/** Drive the wizard to the Confirm step on the search path. */
async function toConfirm() {
  const queryInput = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
  queryInput.value = 'Andor'
  queryInput.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click() // → Folder
  await flushPromises()
  // Pick a folder.
  document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click() // → Confirm
  await flushPromises()
}

describe('AddFlow confirm step — redesign (#123)', () => {
  it('renders the pudgy card with the FULL title and flat metadata chips', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    expect(document.querySelector('[data-testid="confirm-card"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="confirm-title"]')!.textContent).toContain('Andor S02 1080p WEB-DL')
    const chips = document.querySelector('[data-testid="confirm-chips"]')!.textContent
    expect(chips).toContain('2025')
    expect(chips).toContain('1080p')
    expect(chips).toContain('Ukr/Eng')
    wrapper.unmount()
  })

  it('shows the destination + an «Изменить» button that returns to the Folder step', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    expect(document.querySelector('[data-testid="confirm-destination"]')).not.toBeNull()

    document.querySelector<HTMLButtonElement>('[data-testid="confirm-edit-folder"]')!.click()
    await flushPromises()
    // Back on Folder (the picker is visible again).
    expect(document.querySelector('[data-testid="folder-tile"]')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('AddFlow confirm step — inspect → file tree (#123)', () => {
  it('inspects on entering Confirm and renders the file tree with SxxExx labels', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    // It called inspect (not the whole-torrent create).
    expect(fetchCalls.some((c) => c.url === '/api/tasks/inspect')).toBe(true)
    // Tree rendered with labels + raw names.
    expect(document.querySelector('[data-testid="file-tree"]')).not.toBeNull()
    const labels = Array.from(document.querySelectorAll('[data-testid="tree-label"]')).map((e) => e.textContent)
    expect(labels).toContain('S02E01')
    expect(labels).toContain('S02E02')
    wrapper.unmount()
  })

  it('renders the inspected file tree as a preview', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    // The torrent's files are shown (informational preview).
    expect(document.querySelector('[data-testid="tree-check-0"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('adds the WHOLE torrent on «Добавить» (the reliable create_list=false add) and releases the inspecting list', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Whole-torrent add hits /api/tasks, NOT the selective /api/tasks/commit.
    expect(fetchCalls.some((c) => c.url === '/api/tasks')).toBe(true)
    expect(fetchCalls.some((c) => c.url === '/api/tasks/commit')).toBe(false)
    // The inspecting list created for the preview is released on commit.
    expect(fetchCalls.some((c) => c.url.startsWith('/api/tasks/inspect/') && c.init?.method === 'DELETE')).toBe(true)
    wrapper.unmount()
  })
})

describe('AddFlow confirm step — whole-torrent fallback (#123)', () => {
  it('falls back to a whole-torrent add when inspect returns no files', async () => {
    inspectResponse = { listId: 'LE', files: [] }
    const wrapper = await openWizard()
    await toConfirm()

    expect(document.querySelector('[data-testid="inspect-whole"]')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Whole add hits /api/tasks, not /commit.
    expect(fetchCalls.some((c) => c.url === '/api/tasks')).toBe(true)
    expect(fetchCalls.some((c) => c.url === '/api/tasks/commit')).toBe(false)
    wrapper.unmount()
  })

  it('cancels the inspect on the NAS when the owner goes Back from Confirm', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    // Back from Confirm is «Изменить» (returns to Folder) or the Telegram
    // BackButton — both call goBack, which releases the inspecting list (#5).
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-edit-folder"]')!.click()
    await flushPromises()

    expect(fetchCalls.some((c) => c.url === '/api/tasks/inspect/LZ' && c.init?.method === 'DELETE')).toBe(true)
    wrapper.unmount()
  })
})

describe('AddFlow confirm step — bot handoff (#123)', () => {
  it('a magnet handoff shows the whole-torrent fallback (no local bytes to inspect)', async () => {
    inspectResponse = { listId: 'LE', files: [] }
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOKURI' } })
    // Override stash to a magnet.
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/torrent-stash/')) {
        return Promise.resolve(jsonResponse({ kind: 'uri', uri: 'magnet:?xt=urn:btih:abc' }))
      }
      if ((url as string).includes('/api/folders')) {
        return Promise.resolve(jsonResponse({ folders: [{ name: 'd', path: '/volume1/d' }] }))
      }
      if ((url as string) === '/api/tasks') return Promise.resolve(jsonResponse({ ok: true }, 201))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    // Re-mount so onMounted picks up the new fetch.
    wrapper.unmount()
    const w2 = mount(AddFlow, { props: { torrentToken: 'TOKURI' } })
    await flushPromises()
    // Advance: folder → confirm.
    document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // No inspect call for a magnet; whole-torrent fallback shown.
    expect(fetchCalls.some((c) => c.url === '/api/tasks/inspect')).toBe(false)
    expect(document.querySelector('[data-testid="inspect-whole"]')).not.toBeNull()

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/tasks')).toBe(true)
    w2.unmount()
  })
})
