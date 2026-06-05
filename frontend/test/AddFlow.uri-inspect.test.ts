// Per-file inspect for link/URI sources (#220). Toloka links handed off by the
// bot arrive as `mode === 'uri'` and have non-magnet URIs (download.php links).
// These sources have bytes held server-side → the backend already returns an
// instant-tree response from POST /api/tasks/inspect. The frontend was blocking
// inspect for all uri sources; this tests the fix:
//   canInspect true for non-magnet uri, false for magnet: uri
//   currentInspectSource emits a search-kind source for the non-magnet uri
//   the wizard flow reaches the file-tree (inspect) path for a Toloka link
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import AddFlow from '../src/components/AddFlow.vue'

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let stashUri = 'https://toloka.to/download.php?id=12345'

// Reusable fetch mock shared across tests.
function makeFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    // Allow test-level overrides first.
    for (const [pattern, handler] of Object.entries(overrides)) {
      if ((url as string).includes(pattern)) return Promise.resolve(handler())
    }
    if ((url as string).includes('/api/torrent-stash/')) {
      return Promise.resolve(jsonResponse({ kind: 'uri', uri: stashUri }))
    }
    if ((url as string).includes('/api/folders')) {
      return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
    }
    if ((url as string) === '/api/tasks/inspect') {
      // Instant-tree response: server held the bytes and parsed the file tree locally.
      return Promise.resolve(jsonResponse({ inspectToken: 'TOKURI', files: [{ index: 0, name: 'Movie/movie.mkv', size: 4_000_000_000 }] }, 201))
    }
    if ((url as string).startsWith('/api/tasks/inspect/')) {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ ok: true }))
      return Promise.resolve(jsonResponse({ ready: true, files: [{ index: 0, name: 'Movie/movie.mkv', size: 4_000_000_000 }] }))
    }
    if ((url as string) === '/api/tasks/commit') {
      return Promise.resolve(jsonResponse({ ok: true }, 201))
    }
    if ((url as string) === '/api/tasks') {
      return Promise.resolve(jsonResponse({ ok: true }, 201))
    }
    return Promise.resolve(jsonResponse({ folders: [] }))
  }) as typeof fetch
}

beforeEach(() => {
  fetchCalls = []
  stashUri = 'https://toloka.to/download.php?id=12345'
  localStorage.clear()
  globalThis.fetch = makeFetch()
})

afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
  localStorage.clear()
})

// Helper: mount AddFlow with a Toloka handoff token and advance to Confirm.
async function handoffToConfirm(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(AddFlow, { props: { torrentToken: 'TOKURI' } })
  await flushPromises()
  // On Folder step (step 2) — pick a folder and advance.
  document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
  await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
  await flushPromises()
  await flushPromises() // let auto-inspect settle
  return wrapper
}

describe('AddFlow uri mode — per-file inspect for Toloka links (#220)', () => {
  // ── canInspect / currentInspectSource ───────────────────────────────────────
  // These two behaviors are tested via integration (mounted AddFlow). The inspect
  // path is confirmed by observing: (a) inspect is called, (b) the commit path
  // uses commitTask (inspectToken), NOT /api/tasks (whole-torrent).

  it('Toloka link (non-magnet uri): auto-inspect fires on Confirm and returns the file tree', async () => {
    const wrapper = await handoffToConfirm()

    // Inspect POST was called for the Toloka link (not skipped as for magnets).
    const inspectPost = fetchCalls.find((c) => c.url === '/api/tasks/inspect' && c.init?.method === 'POST')
    expect(inspectPost).toBeTruthy()
    // The body must include the stashed Toloka URL so the server can look up the bytes.
    const body = JSON.parse(inspectPost!.init?.body as string)
    expect(body.uri).toBe('https://toloka.to/download.php?id=12345')

    // File tree is shown on the confirm step.
    expect(document.querySelector('[data-testid="confirm-card"]')).not.toBeNull()
    // The create button is enabled (one file ticked by default).
    const createBtn = document.querySelector('[data-testid="create-btn"]') as HTMLButtonElement
    expect(createBtn.disabled).toBe(false)

    wrapper.unmount()
  })

  it('Toloka link: «Добавить» commits via commitTask (inspectToken), NOT whole-torrent /api/tasks', async () => {
    const wrapper = await handoffToConfirm()

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    // Must use the commit endpoint with the inspectToken, not plain createTask.
    const commit = fetchCalls.find((c) => c.url === '/api/tasks/commit')
    expect(commit).toBeTruthy()
    const commitBody = JSON.parse(commit!.init?.body as string)
    expect(commitBody.inspectToken).toBe('TOKURI')
    // No whole-torrent fallback call.
    const wholeTorrent = fetchCalls.find((c) => c.url === '/api/tasks' && c.init?.method === 'POST')
    expect(wholeTorrent).toBeUndefined()

    wrapper.unmount()
  })

  it('magnet uri: inspect is skipped (no bytes on server), whole-torrent add is used', async () => {
    stashUri = 'magnet:?xt=urn:btih:abc123'
    globalThis.fetch = makeFetch()

    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOKMAGNET' } })
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="folder-tile"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    await flushPromises()

    // Inspect must NOT be called for a magnet.
    const inspectPost = fetchCalls.find((c) => c.url === '/api/tasks/inspect' && c.init?.method === 'POST')
    expect(inspectPost).toBeUndefined()

    // «Добавить» uses the whole-torrent path.
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()
    const wholeTorrent = fetchCalls.find((c) => c.url === '/api/tasks' && c.init?.method === 'POST')
    expect(wholeTorrent).toBeTruthy()
    const body = JSON.parse(wholeTorrent!.init?.body as string)
    expect(body.uri).toBe('magnet:?xt=urn:btih:abc123')

    wrapper.unmount()
  })
})
