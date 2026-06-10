// Tests for useShowSearch race-condition guard (issue #293).
// Live-debounced typing fires overlapping requests; a slow earlier request
// resolving LAST must not overwrite results of the newer query, and must not
// clear `loading` while the newer request is still in flight.
// Follows the repo pattern: mock globalThis.fetch (controllable deferred
// promises), bypass the 300ms debounce by making setTimeout synchronous.
import { describe, it, expect, afterEach } from 'bun:test'
import { useShowSearch } from '../src/composables/useShowSearch'
import type { ShowSearchResultView } from '../src/types'

const realFetch = globalThis.fetch
const realSetTimeout = globalThis.setTimeout
afterEach(() => {
  globalThis.fetch = realFetch
  globalThis.setTimeout = realSetTimeout
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const RESULTS_A: ShowSearchResultView[] = [
  { id: 1, title: 'Slow Show A', titleOriginal: null, poster: null, isSubscribed: false },
]
const RESULTS_B: ShowSearchResultView[] = [
  { id: 2, title: 'Fast Show B', titleOriginal: null, poster: null, isSubscribed: true },
]

/** Mock fetch: each /api/shows/search call returns a controllable promise, keyed by q. */
function makeDeferredSearchFetch() {
  const pending = new Map<string, ReturnType<typeof deferred<Response>>>()
  globalThis.fetch = ((url: string) => {
    const q = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
    const d = deferred<Response>()
    pending.set(q, d)
    return d.promise
  }) as typeof fetch
  return pending
}

/** Let the microtask queue settle (fetch .then chains in api.ts). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('useShowSearch — overlapping request race (issue #293)', () => {
  it('a slow earlier request resolving last does not overwrite newer results or loading', async () => {
    const pending = makeDeferredSearchFetch()
    // Bypass the 300ms debounce: fire the timer callback synchronously.
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 }) as typeof setTimeout

    const { results, loading, error, debouncedSearch } = useShowSearch()

    // Request A (slow), then request B (fast) — both in flight.
    debouncedSearch('breaking')
    await flush()
    debouncedSearch('breaking bad')
    await flush()
    expect(pending.has('breaking')).toBe(true)
    expect(pending.has('breaking bad')).toBe(true)
    expect(loading.value).toBe(true)

    // B resolves first → its results land, loading clears.
    pending.get('breaking bad')!.resolve(jsonResponse({ results: RESULTS_B }))
    await flush()
    expect(results.value).toEqual(RESULTS_B)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()

    // A settles late → discarded entirely: results stay B's, loading stays false.
    pending.get('breaking')!.resolve(jsonResponse({ results: RESULTS_A }))
    await flush()
    expect(results.value).toEqual(RESULTS_B)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('keeps loading=true when the stale request settles while the latest is still in flight', async () => {
    const pending = makeDeferredSearchFetch()
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 }) as typeof setTimeout

    const { results, loading, error, debouncedSearch } = useShowSearch()

    debouncedSearch('breaking')
    await flush()
    debouncedSearch('breaking bad')
    await flush()

    // Stale A resolves while B is still pending → nothing changes, still loading.
    pending.get('breaking')!.resolve(jsonResponse({ results: RESULTS_A }))
    await flush()
    expect(results.value).toEqual([])
    expect(loading.value).toBe(true)

    // Latest B resolves → its results land, loading clears.
    pending.get('breaking bad')!.resolve(jsonResponse({ results: RESULTS_B }))
    await flush()
    expect(results.value).toEqual(RESULTS_B)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('a stale request failing late does not set error or wipe newer results', async () => {
    const pending = makeDeferredSearchFetch()
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 }) as typeof setTimeout

    const { results, loading, error, debouncedSearch } = useShowSearch()

    debouncedSearch('breaking')
    await flush()
    debouncedSearch('breaking bad')
    await flush()

    pending.get('breaking bad')!.resolve(jsonResponse({ results: RESULTS_B }))
    await flush()
    expect(results.value).toEqual(RESULTS_B)

    // Stale A rejects late → no error, results untouched.
    pending.get('breaking')!.reject(new Error('network down'))
    await flush()
    expect(error.value).toBeNull()
    expect(results.value).toEqual(RESULTS_B)
    expect(loading.value).toBe(false)
  })
})
