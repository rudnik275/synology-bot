// Shared backend sync for UI string lists (#4, race fix #303).
//
// Telegram WebView localStorage is wiped between sessions/redeploys, so MRU
// lists (search history, folder recents/favorites) hydrate from the backend
// ui-state store. The hydration GET races local mutations: tapping a folder /
// firing a search right after launch mutates the list BEFORE a slow GET
// resolves, and naively assigning the server payload then erases the just-made
// mutation (and the stale list gets persisted back on the next push). The fix:
// once any local mutation happened, the in-flight GET's payload is stale by
// definition — discard it. Local state always wins the race.
import type { Ref } from 'vue'
import { api } from '../api'
import { inTelegram } from '../telegram'

export interface UiListSync {
  /**
   * Call AFTER every local mutation of the list. Marks the list as locally
   * mutated (so a still-in-flight hydration GET is discarded when it lands)
   * and persists the current value to the backend (when sync is enabled).
   */
  push: () => void
}

export function syncUiList(opts: {
  /** The reactive list to hydrate / persist. */
  list: Ref<string[]>
  /** Backend ui-state key ('search-history' | 'folder-recents' | 'folder-favorites'). */
  uiKey: string
  /** Persist hydrated server values into the local cache (localStorage). */
  persistLocal: (values: string[]) => void
  /** Sync on/off — defaults to inTelegram (backend sync only inside Telegram). */
  enabled?: boolean
  /** Injectable transports for tests; default to the real api client. */
  get?: (key: string) => Promise<string[]>
  put?: (key: string, values: string[]) => Promise<void>
}): UiListSync {
  const enabled = opts.enabled ?? inTelegram
  const get = opts.get ?? api.uiState
  const put = opts.put ?? api.setUiState

  // Set by the first local mutation; from then on the hydration payload is stale.
  let mutated = false

  // Hydrate from the backend (the cross-session source of truth). If the backend
  // has nothing yet but the local cache does, seed the backend from the cache.
  if (enabled) {
    get(opts.uiKey)
      .then((values) => {
        // #303: a local mutation won the race — the server copy predates it and
        // applying it would erase the just-used entry. Drop the payload; the
        // mutation's own push already (or will) bring the backend up to date.
        if (mutated) return
        if (values.length > 0) {
          opts.list.value = values
          opts.persistLocal(values)
        } else if (opts.list.value.length > 0) {
          void put(opts.uiKey, opts.list.value).catch(() => {})
        }
      })
      .catch(() => {})
  }

  function push(): void {
    mutated = true
    if (enabled) void put(opts.uiKey, opts.list.value).catch(() => {})
  }

  return { push }
}
