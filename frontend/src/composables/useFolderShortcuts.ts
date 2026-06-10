// Composable for folder shortcuts: persists last-used folder, recents (MRU),
// and favorites (#306). localStorage is the instant-paint cache + dev/test
// store; the recents and favorites lists also sync to the backend (#4) inside
// Telegram so they survive the WebView wiping localStorage between
// sessions/redeploys.
import { ref } from 'vue'
import { syncUiList } from './uiListSync'

const UI_KEY_RECENTS = 'folder-recents'
const UI_KEY_FAVORITES = 'folder-favorites'

const KEY_RECENTS = 'nas-bot:folder-recents'
const KEY_FAVORITES = 'nas-bot:folder-favorites'
const KEY_LAST = 'nas-bot:last-folder'

const RECENTS_CAP = 6
const FAVORITES_CAP = 5

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // no-op
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // no-op
  }
}

function readStringArray(key: string): string[] {
  const raw = safeGetItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as string[]
  } catch {
    // ignore malformed data
  }
  return []
}

export function useFolderShortcuts() {
  const recents = ref<string[]>(readStringArray(KEY_RECENTS))
  const favorites = ref<string[]>(readStringArray(KEY_FAVORITES))
  const lastFolder = ref<string | null>(safeGetItem(KEY_LAST))

  // Backend hydration + persistence with the #303 race guard: once a local
  // mutation happened, a still-in-flight hydration GET's payload is discarded.
  const recentsSync = syncUiList({
    list: recents,
    uiKey: UI_KEY_RECENTS,
    persistLocal: (values) => safeSetItem(KEY_RECENTS, JSON.stringify(values)),
  })
  const favoritesSync = syncUiList({
    list: favorites,
    uiKey: UI_KEY_FAVORITES,
    persistLocal: (values) => safeSetItem(KEY_FAVORITES, JSON.stringify(values)),
  })

  function recordRecent(path: string): void {
    // Dedupe: remove existing occurrence then unshift to front
    const deduped = recents.value.filter((p) => p !== path)
    deduped.unshift(path)
    // Cap at RECENTS_CAP
    recents.value = deduped.slice(0, RECENTS_CAP)
    lastFolder.value = path
    safeSetItem(KEY_RECENTS, JSON.stringify(recents.value))
    safeSetItem(KEY_LAST, path)
    recentsSync.push()
  }

  function toggleFavorite(path: string): void {
    if (favorites.value.includes(path)) {
      favorites.value = favorites.value.filter((p) => p !== path)
    } else {
      // Cap at FAVORITES_CAP, keeping the most recently pinned.
      favorites.value = [...favorites.value, path].slice(-FAVORITES_CAP)
    }
    safeSetItem(KEY_FAVORITES, JSON.stringify(favorites.value))
    favoritesSync.push()
  }

  function clearLastIfMissing(): void {
    lastFolder.value = null
    safeRemoveItem(KEY_LAST)
  }

  return { recents, favorites, lastFolder, recordRecent, toggleFavorite, clearLastIfMissing }
}
