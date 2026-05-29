// Unit tests for the useApi base composable (#60): the Authorization header is
// injected, the URL is prefixed with /api, and loading/error/data transition
// correctly against a mocked fetch.
import { describe, it, expect, afterEach } from 'bun:test'
import { createApp } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useApi } from '../src/composables/useApi'

// Drive a composable inside a real (throwaway) component instance so onMounted /
// onUnmounted fire — the same pattern future composable tests reuse.
function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { result, unmount: () => app.unmount() }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useApi', () => {
  it('prefixes /api and injects the Authorization: tma header', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ ok: true }))
    }) as typeof fetch

    const { result, unmount } = withSetup(() => useApi('/health'))
    await flushPromises()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/api/health')
    const auth = (calls[0]!.init?.headers as Record<string, string>).Authorization
    expect(auth.startsWith('tma')).toBe(true)
    expect(result.data.value).toEqual({ ok: true })
    unmount()
  })

  it('toggles loading around the request and stores data', async () => {
    let resolveFetch!: (r: Response) => void
    globalThis.fetch = (() => new Promise<Response>((r) => (resolveFetch = r))) as typeof fetch

    const { result, unmount } = withSetup(() => useApi<{ a: number }>('/x', { immediate: false }))
    expect(result.loading.value).toBe(false)

    const p = result.refetch()
    expect(result.loading.value).toBe(true)

    resolveFetch(jsonResponse({ a: 1 }))
    await p

    expect(result.loading.value).toBe(false)
    expect(result.data.value).toEqual({ a: 1 })
    expect(result.error.value).toBeNull()
    unmount()
  })

  it('captures the server error message on a non-ok response', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ error: 'boom' }, 500))) as typeof fetch

    const { result, unmount } = withSetup(() => useApi('/x', { immediate: false }))
    await result.refetch()

    expect(result.error.value).toBe('boom')
    expect(result.data.value).toBeNull()
    expect(result.loading.value).toBe(false)
    unmount()
  })
})
