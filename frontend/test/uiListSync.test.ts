// Tests for the shared ui-state list sync helper (#303 hydration race).
//
// The bug: useSearchHistory/useFolderShortcuts fired a hydration GET at
// construction and assigned the payload whenever it resolved — a SLOW GET
// overwrote local mutations made meanwhile (the just-used query/folder
// disappeared, and the stale list was then persisted back). syncUiList
// discards the hydration payload once any local mutation happened.
import { describe, it, expect } from 'bun:test'
import { ref } from 'vue'
import { syncUiList } from '../src/composables/uiListSync'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let the .then chains attached to the resolved GET run. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('syncUiList (#303)', () => {
  it('hydrates the list from the server when nothing mutated locally', async () => {
    const list = ref<string[]>(['cached'])
    const persisted: string[][] = []
    const get = deferred<string[]>()

    syncUiList({
      list,
      uiKey: 'k',
      enabled: true,
      persistLocal: (v) => persisted.push(v),
      get: () => get.promise,
      put: async () => {},
    })

    get.resolve(['server-a', 'server-b'])
    await flushMicrotasks()

    expect(list.value).toEqual(['server-a', 'server-b'])
    expect(persisted).toEqual([['server-a', 'server-b']])
  })

  it('discards a slow hydration payload once a local mutation happened', async () => {
    const list = ref<string[]>([])
    const persisted: string[][] = []
    const get = deferred<string[]>()
    const puts: string[][] = []

    const sync = syncUiList({
      list,
      uiKey: 'k',
      enabled: true,
      persistLocal: (v) => persisted.push(v),
      get: () => get.promise,
      put: async (_k, values) => {
        puts.push(values)
      },
    })

    // Local mutation while the GET is still in flight (user just used a query/folder).
    list.value = ['just-used']
    sync.push()

    // The stale server copy resolves AFTER the mutation — it must be discarded.
    get.resolve(['stale-1', 'stale-2'])
    await flushMicrotasks()

    expect(list.value).toEqual(['just-used'])
    expect(persisted).toEqual([]) // stale payload never written to the local cache
    expect(puts).toEqual([['just-used']]) // and the mutation reached the backend
  })

  it('seeds the backend from the local cache when the server has nothing', async () => {
    const list = ref<string[]>(['local-only'])
    const puts: Array<[string, string[]]> = []

    syncUiList({
      list,
      uiKey: 'seed-key',
      enabled: true,
      persistLocal: () => {},
      get: async () => [],
      put: async (key, values) => {
        puts.push([key, values])
      },
    })
    await flushMicrotasks()

    expect(list.value).toEqual(['local-only'])
    expect(puts).toEqual([['seed-key', ['local-only']]])
  })

  it('push persists the current list to the backend', async () => {
    const list = ref<string[]>([])
    const puts: string[][] = []

    const sync = syncUiList({
      list,
      uiKey: 'k',
      enabled: true,
      persistLocal: () => {},
      get: async () => [],
      put: async (_k, values) => {
        puts.push(values)
      },
    })

    list.value = ['a']
    sync.push()
    await flushMicrotasks()

    expect(puts).toContainEqual(['a'])
  })

  it('does nothing when disabled (outside Telegram)', async () => {
    const list = ref<string[]>(['local'])
    let gets = 0
    let putsCount = 0

    const sync = syncUiList({
      list,
      uiKey: 'k',
      enabled: false,
      persistLocal: () => {},
      get: async () => {
        gets++
        return ['server']
      },
      put: async () => {
        putsCount++
      },
    })

    list.value = ['mutated']
    sync.push()
    await flushMicrotasks()

    expect(gets).toBe(0)
    expect(putsCount).toBe(0)
    expect(list.value).toEqual(['mutated'])
  })

  it('survives a failing GET (hydration errors are swallowed)', async () => {
    const list = ref<string[]>(['cached'])
    const get = deferred<string[]>()

    syncUiList({
      list,
      uiKey: 'k',
      enabled: true,
      persistLocal: () => {},
      get: () => get.promise,
      put: async () => {},
    })

    get.reject(new Error('network down'))
    await flushMicrotasks()

    expect(list.value).toEqual(['cached'])
  })
})
