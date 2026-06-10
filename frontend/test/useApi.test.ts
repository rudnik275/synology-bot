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

  it('background refetch does NOT flip loading to true', async () => {
    // First foreground fetch populates data
    let callCount = 0
    globalThis.fetch = (() => {
      callCount++
      return Promise.resolve(jsonResponse({ value: callCount }))
    }) as typeof fetch

    const { result, unmount } = withSetup(() => useApi<{ value: number }>('/x', { immediate: false }))

    // Foreground fetch — loading should toggle true then false
    await result.refetch()
    expect(result.data.value).toEqual({ value: 1 })
    expect(result.loading.value).toBe(false)

    // Background fetch — loading must stay false throughout
    const loadingValues: boolean[] = []
    let resolveBg!: (r: Response) => void
    globalThis.fetch = (() => new Promise<Response>((r) => (resolveBg = r))) as typeof fetch

    const bgPromise = result.refetch({ background: true })
    // loading must NOT have been set to true
    loadingValues.push(result.loading.value)
    resolveBg(jsonResponse({ value: 99 }))
    await bgPromise
    loadingValues.push(result.loading.value)

    expect(loadingValues).toEqual([false, false])
    // data IS updated on success
    expect(result.data.value).toEqual({ value: 99 })
    unmount()
  })

  it('foreground refetch still toggles loading correctly', async () => {
    let resolveFetch!: (r: Response) => void
    globalThis.fetch = (() => new Promise<Response>((r) => (resolveFetch = r))) as typeof fetch

    const { result, unmount } = withSetup(() => useApi<{ a: number }>('/x', { immediate: false }))

    const p = result.refetch()
    expect(result.loading.value).toBe(true)
    resolveFetch(jsonResponse({ a: 42 }))
    await p
    expect(result.loading.value).toBe(false)
    expect(result.data.value).toEqual({ a: 42 })
    unmount()
  })

  it('failed background fetch keeps prior data intact and does not set error', async () => {
    // First set up good data via foreground fetch
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ value: 1 }))) as typeof fetch
    const { result, unmount } = withSetup(() => useApi<{ value: number }>('/x', { immediate: false }))
    await result.refetch()
    expect(result.data.value).toEqual({ value: 1 })
    expect(result.error.value).toBeNull()

    // Now background fetch fails
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ error: 'network blip' }, 500))) as typeof fetch
    await result.refetch({ background: true })

    // Data should be preserved, error should NOT be set by a background fetch
    expect(result.data.value).toEqual({ value: 1 })
    expect(result.error.value).toBeNull()
    expect(result.loading.value).toBe(false)
    unmount()
  })

  it('successful background fetch clears an error set by a prior foreground failure', async () => {
    // Foreground failure sets the error
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ error: 'boom' }, 500))) as typeof fetch
    const { result, unmount } = withSetup(() => useApi<{ value: number }>('/x', { immediate: false }))
    await result.refetch()
    expect(result.error.value).toBe('boom')

    // A later successful background poll must clear the sticky error
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ value: 7 }))) as typeof fetch
    await result.refetch({ background: true })

    expect(result.data.value).toEqual({ value: 7 })
    expect(result.error.value).toBeNull()
    expect(result.loading.value).toBe(false)
    unmount()
  })

  it('discards an out-of-order stale response (slow A resolves after fast B)', async () => {
    const resolvers: ((r: Response) => void)[] = []
    globalThis.fetch = (() => new Promise<Response>((r) => resolvers.push(r))) as typeof fetch

    const { result, unmount } = withSetup(() => useApi<{ value: number }>('/x', { immediate: false }))

    // Slow request A (e.g. a background poll), then fast request B (foreground)
    const pA = result.refetch({ background: true })
    const pB = result.refetch()
    expect(resolvers).toHaveLength(2)

    // B settles first with fresh data
    resolvers[1]!(jsonResponse({ value: 2 }))
    await pB
    expect(result.data.value).toEqual({ value: 2 })
    expect(result.loading.value).toBe(false)

    // A settles later with stale data — must be discarded entirely
    resolvers[0]!(jsonResponse({ value: 1 }))
    await pA
    expect(result.data.value).toEqual({ value: 2 })
    expect(result.error.value).toBeNull()
    expect(result.loading.value).toBe(false)
    unmount()
  })
})
