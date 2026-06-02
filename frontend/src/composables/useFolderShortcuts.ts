// Composable for folder shortcuts: persists last-used folder, recents (MRU),
// and favorites. localStorage is the instant-paint cache + dev/test store; the
// recents list also syncs to the backend (#4) inside Telegram so it survives
// the WebView wiping localStorage between sessions/redeploys.
import { ref } from 'vue'
import { api } from '../api'
import { inTelegram } from '../telegram'

const UI_KEY_RECENTS = 'folder-recents'

const KEY_RECENTS = 'nas-bot:folder-recents'
const KEY_FAVORITES = 'nas-bot:folder-favorites'
const KEY_LAST = 'nas-bot:last-folder'

const RECENTS_CAP = 6

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

  // Hydrate recents from the backend (cross-session source of truth, #4); seed
  // the backend from the local cache when it has nothing yet.
  if (inTelegram) {
    api
      .uiState(UI_KEY_RECENTS)
      .then((values) => {
        if (values.length > 0) {
          recents.value = values
          safeSetItem(KEY_RECENTS, JSON.stringify(values))
        } else if (recents.value.length > 0) {
          void api.setUiState(UI_KEY_RECENTS, recents.value).catch(() => {})
        }
      })
      .catch(() => {})
  }

  function recordRecent(path: string): void {
    // Dedupe: remove existing occurrence then unshift to front
    const deduped = recents.value.filter((p) => p !== path)
    deduped.unshift(path)
    // Cap at RECENTS_CAP
    recents.value = deduped.slice(0, RECENTS_CAP)
    lastFolder.value = path
    safeSetItem(KEY_RECENTS, JSON.stringify(recents.value))
    safeSetItem(KEY_LAST, path)
    if (inTelegram) void api.setUiState(UI_KEY_RECENTS, recents.value).catch(() => {})
  }

  function toggleFavorite(path: string): void {
    if (favorites.value.includes(path)) {
      favorites.value = favorites.value.filter((p) => p !== path)
    } else {
      favorites.value = [...favorites.value, path]
    }
    safeSetItem(KEY_FAVORITES, JSON.stringify(favorites.value))
  }

  function clearLastIfMissing(): void {
    lastFolder.value = null
    safeRemoveItem(KEY_LAST)
  }

  return { recents, favorites, lastFolder, recordRecent, toggleFavorite, clearLastIfMissing }
}
