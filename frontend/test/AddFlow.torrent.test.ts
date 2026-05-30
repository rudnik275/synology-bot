// #99 — AddFlow auto-opens in torrent mode when the Mini App is launched from a
// bot deep-link carrying a stashed .torrent token. The token is injected via the
// `torrentToken` prop (its production default is the parsed Telegram start_param),
// so this needs no global telegram module mock.
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

beforeEach(() => {
  fetchCalls = []
  // Folder shortcuts persist the last-used folder to localStorage; isolate it so
  // a completed create here doesn't pre-fill destination in other AddFlow tests.
  localStorage.clear()
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    if ((url as string).includes('/api/torrent-stash/')) {
      return Promise.resolve(jsonResponse({ name: 'Forwarded.torrent', base64: btoa('\x01\x02\x03\x04') }))
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

describe('AddFlow torrent deep-link (#99)', () => {
  it('auto-opens the sheet at the folder step with the stashed file loaded', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    // Sheet is open without any FAB tap.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // It fetched the stash by token.
    expect(fetchCalls.some((c) => c.url.includes('/api/torrent-stash/TOK123'))).toBe(true)
    // Jumped to the folder step (FolderPicker present, not the source cards).
    expect(document.querySelector('[data-testid="pick-btn"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="mode-search"]')).toBeNull()
    wrapper.unmount()
  })

  it('submits the stashed file as multipart to /api/tasks', async () => {
    const wrapper = mount(AddFlow, { props: { torrentToken: 'TOK123' } })
    await flushPromises()

    // Pick a folder, advance to confirm, submit.
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
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.find('button.fab').exists()).toBe(true)
    wrapper.unmount()
  })
})
