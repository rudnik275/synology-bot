// Confirm-step per-file selection (#123) — restored file TREE design on the
// verified two-call inspect backend (POST /api/tasks/inspect → list_id; GET
// /api/tasks/inspect/:id → {ready,files}; POST /api/tasks/commit → subset).
//
// Reaching Confirm AUTO-inspects (no opt-in button) and renders the tree; the
// owner toggles per-file checkboxes; «Добавить» commits the selected subset.
// Magnets / inspect failures fall back to a whole-torrent add.
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

// All under one root folder → buildFileTree collapses it to a crumb, leaving a
// flat list of file rows (every tree-check-N visible without expanding folders).
const INSPECT_FILES = [
  { index: 0, name: 'Andor.S02/Andor.S02E01.1080p.mkv', size: 3_100_000_000 },
  { index: 1, name: 'Andor.S02/Andor.S02E02.1080p.mkv', size: 2_900_000_000 },
  { index: 2, name: 'Andor.S02/poster.jpg', size: 1_200_000 },
]

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let inspectFiles: Array<{ index: number; name: string; size: number }> = INSPECT_FILES

beforeEach(() => {
  fetchCalls = []
  inspectFiles = INSPECT_FILES
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
      // Instant-tree contract (#161, deferred-create): the server parsed the
      // .torrent bytes locally and returns the file tree with an `inspectToken`
      // (no DSM list yet, no poll). An empty list returns just `{listId}` so the
      // client falls back to the magnet-style poll/whole path.
      if (inspectFiles.length > 0) return Promise.resolve(jsonResponse({ inspectToken: 'TOK', files: inspectFiles }, 201))
      return Promise.resolve(jsonResponse({ listId: 'LZ' }, 201))
    }
    if ((url as string).startsWith('/api/tasks/inspect/')) {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ ok: true }))
      return Promise.resolve(jsonResponse({ ready: true, title: 'Andor.S02', size: 6_001_200_000, files: inspectFiles }))
    }
    if ((url as string) === '/api/tasks/commit') {
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

async function openWizard() {
  const wrapper = mount(AddFlow)
  ;(wrapper.vm as unknown as { openSheet: () => void }).openSheet()
  await flushPromises()
  return wrapper
}

/** Drive the search path to the Confirm step (which auto-inspects). */
async function toConfirm() {
  const q = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
  q.value = 'Andor'
  q.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click() // → Folder
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click() // → Confirm
  await flushPromises()
  await flushPromises() // let the auto-inspect (inspect POST + poll GET) settle
}

describe('AddFlow confirm — inspect → file tree (#123)', () => {
  it('auto-inspects on entering Confirm and renders the file tree with SxxExx labels', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    // It inspected (create_list), not the whole-torrent create.
    const inspect = fetchCalls.find((c) => c.url === '/api/tasks/inspect' && c.init?.method === 'POST')
    expect(inspect).toBeTruthy()
    expect(JSON.parse(inspect!.init?.body as string).uri).toBe('https://toloka.to/download.php?id=1')

    expect(document.querySelector('[data-testid="file-tree"]')).not.toBeNull()
    const labels = Array.from(document.querySelectorAll('[data-testid="tree-label"]')).map((e) => e.textContent)
    expect(labels).toContain('S02E01')
    expect(labels).toContain('S02E02')
    wrapper.unmount()
  })

  it('uses the instant tree from the inspect POST and does NOT poll GET /api/tasks/inspect/:id (#161)', async () => {
    const wrapper = await openWizard()
    await toConfirm()

    // Tree is shown…
    expect(document.querySelector('[data-testid="file-tree"]')).not.toBeNull()
    // …and we never polled the per-list endpoint (the POST already carried files).
    const polled = fetchCalls.some(
      (c) => c.url.startsWith('/api/tasks/inspect/') && c.init?.method !== 'DELETE'
    )
    expect(polled).toBe(false)
    wrapper.unmount()
  })

  it('«Добавить» commits the selected subset (all files ticked by default)', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    const body = JSON.parse(commit!.init?.body as string)
    expect(body.inspectToken).toBe('TOK')
    expect([...body.selected].sort((a: number, b: number) => a - b)).toEqual([0, 1, 2])
    wrapper.unmount()
  })

  it('unticking a file commits only the kept indices', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    // Untick the poster (index 2) via its tree checkbox.
    document.querySelector<HTMLElement>('[data-testid="tree-check-2"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    expect([...JSON.parse(commit!.init?.body as string).selected].sort((a: number, b: number) => a - b)).toEqual([0, 1])
    wrapper.unmount()
  })

  it('Add is disabled when every file is unticked', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    for (const i of [0, 1, 2]) {
      document.querySelector<HTMLElement>(`[data-testid="tree-check-${i}"]`)!.click()
      await flushPromises()
    }
    expect((document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('does NOT hit the NAS when the owner goes Back from Confirm (instant-tree creates no list to release)', async () => {
    const wrapper = await openWizard()
    await toConfirm()
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-edit-folder"]')!.click()
    await flushPromises()
    // The instant-tree path defers createInspectList to commit, so reaching Confirm
    // creates no DSM list — backing out has nothing to delete (no orphan, no call).
    expect(fetchCalls.some((c) => c.url.startsWith('/api/tasks/inspect/') && c.init?.method === 'DELETE')).toBe(false)
    wrapper.unmount()
  })
})

describe('AddFlow confirm — fast-tap while still inspecting (#161)', () => {
  it('chains the commit on the in-flight inspect when «Добавить» is tapped before it resolves', async () => {
    // Gate the inspect POST so the tap lands while inspectState === 'inspecting'.
    let releaseInspect: (() => void) | null = null
    const gate = new Promise<void>((r) => { releaseInspect = r })
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/folders')) {
        return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
      }
      if ((url as string).includes('/api/search')) {
        return Promise.resolve(jsonResponse({ results: SEARCH_RESULTS }))
      }
      if ((url as string) === '/api/tasks/inspect') {
        // Resolve only after the gate opens — the tap happens before this.
        return gate.then(() => jsonResponse({ inspectToken: 'TOK', files: INSPECT_FILES }, 201))
      }
      if ((url as string) === '/api/tasks/commit') {
        return Promise.resolve(jsonResponse({ ok: true }, 201))
      }
      if ((url as string).startsWith('/api/tasks/inspect/')) {
        if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ ok: true }))
      }
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = await openWizard()
    // Drive to Confirm WITHOUT settling the inspect (its POST is gated).
    const q = document.querySelector('[data-testid="search-query"]') as HTMLInputElement
    q.value = 'Andor'
    q.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="search-btn"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="result-r1"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click() // → Confirm, inspect starts (gated)
    await flushPromises()

    // Inspect is still in flight — the loading state is shown, no tree yet.
    expect(document.querySelector('[data-testid="inspect-loading"]')).not.toBeNull()

    // Fast-tap «Добавить» NOW (while inspecting). Sheet closes instantly.
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // The commit has NOT fired yet — it's chained on the pending inspect.
    expect(fetchCalls.some((c) => c.url === '/api/tasks/commit')).toBe(false)

    // Release the inspect → the chained commit fires with the resolved handle.
    releaseInspect!()
    await flushPromises()
    await flushPromises()
    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    expect(JSON.parse(commit!.init?.body as string).inspectToken).toBe('TOK')
    // It must NOT have deleted anything (the instant-tree path holds no NAS list).
    expect(fetchCalls.some((c) => c.url.startsWith('/api/tasks/inspect/') && c.init?.method === 'DELETE')).toBe(false)
    wrapper.unmount()
  })
})

describe('AddFlow confirm — whole-torrent fallback (#123)', () => {
  it('falls back to a whole-torrent add when inspect resolves no files', async () => {
    inspectFiles = []
    const wrapper = await openWizard()
    await toConfirm()

    expect(document.querySelector('[data-testid="inspect-whole"]')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    expect(fetchCalls.some((c) => c.url === '/api/tasks')).toBe(true)
    expect(fetchCalls.some((c) => c.url === '/api/tasks/commit')).toBe(false)
    wrapper.unmount()
  })
})
