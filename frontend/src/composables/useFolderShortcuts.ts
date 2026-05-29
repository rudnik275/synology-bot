// Composable for folder shortcuts: persists last-used folder, recents (MRU),
// and favorites. All storage is localStorage-backed with try/catch guards for
// environments where localStorage is unavailable or throws.
import { ref } from 'vue'

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

  function recordRecent(path: string): void {
    // Dedupe: remove existing occurrence then unshift to front
    const deduped = recents.value.filter((p) => p !== path)
    deduped.unshift(path)
    // Cap at RECENTS_CAP
    recents.value = deduped.slice(0, RECENTS_CAP)
    lastFolder.value = path
    safeSetItem(KEY_RECENTS, JSON.stringify(recents.value))
    safeSetItem(KEY_LAST, path)
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
