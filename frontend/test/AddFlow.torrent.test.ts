// Bot-handoff path (#99 bytes, generalized #120 uri): AddFlow auto-opens at the
// Folder step when the Mini App is launched from a bot deep-link carrying a stash
// token. The token is injected via the `torrentToken` prop (its production
// default is the parsed Telegram start_param), so this needs no telegram mock.
//
// The stash GET returns a discriminated payload:
//   { kind: 'bytes', name, base64 } — a forwarded .torrent (#99)
//   { kind: 'uri', uri }            — a magnet/URL pasted into the bot (#120)
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
// What /api/torrent-stash/:token resolves to for the test under run.
let stashResponse: unknown = { kind: 'bytes', name: 'Forwarded.torrent', base64: btoa('\x01\x02\x03\x04') }

beforeEach(() => {
  fetchCalls = []
  stashResponse = { kind: 'bytes', name: 'Forwarded.torrent', base64: btoa('\x01\x02\x03\x04') }
  // Folder shortcuts persist the last-used folder to localStorage; isolate it so
  // a completed create here doesn't pre-fill destination in other AddFlow tests.
  localStorage.clear()
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    if ((url as string).includes('/api/torrent-stash/')) {
      return Promise.resolve(jsonResponse(stashResponse))
    }
    if ((url as string).includes('/api/folders')) {
      return Promise.resolve(jsonResponse({ folders: [{ name: 'downloads', path: '/volume1/downloads' }] }))
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

describe('AddFlow bot handoff — .torrent bytes (#99)', () => {
  it('auto-opens the sheet at the folder step with the stashed file loaded', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    // Sheet is open without any FAB tap.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // It fetched the stash by token.
    expect(fetchCalls.some((c) => c.url.includes('/api/torrent-stash/TOK123'))).toBe(true)
    // Jumped to the folder step — Variant D: no history → tree shown directly.
    // FolderPicker renders folder-item (tree) not tiles; Search is not drawn.
    expect(document.querySelector('[data-testid="folder-item"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="search-query"]')).toBeNull()
    // No Back button — Folder is the first drawn step on the handoff path.
    expect(document.querySelector('[data-testid="wizard-back"]')).toBeNull()
    wrapper.unmount()
  })

  it('submits the stashed file as multipart to /api/tasks', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    // Variant D: drill into a folder, then pick it, then advance to confirm.
    document.querySelector<HTMLButtonElement>('[data-testid="folder-item"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="pick-btn"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    expect(taskCall!.init?.body).toBeInstanceOf(FormData)
    const file = (taskCall!.init?.body as FormData).get('file') as File
    expect(file.name).toBe('Forwarded.torrent')
    wrapper.unmount()
  })

  it('does NOT auto-open without a token (normal Downloads entry)', async () => {
    const wrapper = mount(AddFlow)
    await flushPromises()
    // Sheet stays closed — the wizard is only opened by the inline add-row tap (#118).
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // The floating FAB is removed in #118; the inline row lives in DownloadsTab.
    expect(wrapper.find('button.fab').exists()).toBe(false)
    wrapper.unmount()
  })

  // ─── Stepper frame on handoff path (#119) ─────────────────────────────────
  it('stepper renders 2 circles on the handoff path (Папка · Готово)', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    const stepper = document.querySelector('[data-testid="stepper"]')!
    expect(stepper).not.toBeNull()
    const circles = stepper.querySelectorAll('.stepper-circle')
    expect(circles.length).toBe(2)
    const labels = Array.from(stepper.querySelectorAll('.stepper-label')).map((el) => el.textContent?.trim())
    expect(labels).toEqual(['Папка', 'Готово'])
    wrapper.unmount()
  })

  it('Add button appears on step 2 (last step of handoff path, not step 3)', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    // On Folder step (step 2) — still Next, no Add.
    expect(document.querySelector('[data-testid="create-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).not.toBeNull()

    // Advance to Confirm (step 3). Variant D: drill into a folder, then pick it.
    document.querySelector<HTMLButtonElement>('[data-testid="folder-item"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="pick-btn"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()

    // On Confirm step — Add appears, Next gone.
    expect(document.querySelector('[data-testid="create-btn"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="wizard-next"]')).toBeNull()
    wrapper.unmount()
  })
})

describe('AddFlow bot handoff — magnet/URL uri (#120)', () => {
  it('auto-opens at the folder step with the stashed URI pre-loaded', async () => {
    stashResponse = { kind: 'uri', uri: 'magnet:?xt=urn:btih:abc123' }
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOKURI' } })
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(fetchCalls.some((c) => c.url.includes('/api/torrent-stash/TOKURI'))).toBe(true)
    // Folder step — Variant D: no history → tree shown directly.
    // Search not drawn, no Back on the first drawn step.
    expect(document.querySelector('[data-testid="folder-item"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="search-query"]')).toBeNull()
    expect(document.querySelector('[data-testid="wizard-back"]')).toBeNull()
    wrapper.unmount()
  })

  it('submits the stashed URI as JSON to /api/tasks (not multipart)', async () => {
    stashResponse = { kind: 'uri', uri: 'magnet:?xt=urn:btih:abc123' }
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOKURI' } })
    await flushPromises()

    // Variant D: drill into a folder, then pick it.
    document.querySelector<HTMLButtonElement>('[data-testid="folder-item"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="pick-btn"]')!.click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')!.click()
    await flushPromises()
    // Confirm shows the link.
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('magnet:?xt=urn:btih:abc123')

    document.querySelector<HTMLButtonElement>('[data-testid="create-btn"]')!.click()
    await flushPromises()

    const taskCall = fetchCalls.find((c) => c.url === '/api/tasks')
    expect(taskCall).toBeTruthy()
    // JSON body, not FormData.
    expect(taskCall!.init?.body).not.toBeInstanceOf(FormData)
    const contentType = (taskCall!.init?.headers as Record<string, string>)['Content-Type']
    expect(contentType).toContain('application/json')
    const body = JSON.parse(taskCall!.init?.body as string)
    expect(body.uri).toBe('magnet:?xt=urn:btih:abc123')
    expect(body.destination).toBeTruthy()
    wrapper.unmount()
  })

  it('falls back to the in-app search flow when the stash fetch fails', async () => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      if ((url as string).includes('/api/torrent-stash/')) return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      if ((url as string).includes('/api/folders')) return Promise.resolve(jsonResponse({ folders: [] }))
      return Promise.resolve(jsonResponse({ folders: [] }))
    }) as typeof fetch

    const wrapper = mount(AddFlow, { props: { torrentToken: 'GONE' } })
    await flushPromises()

    // Recovery: sheet stays open on the Search step (not the folder step).
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="search-query"]')).not.toBeNull()
    wrapper.unmount()
  })
})
