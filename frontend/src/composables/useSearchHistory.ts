// Composable for search history: persists recent search queries (MRU).
// All storage is localStorage-backed with try/catch guards for environments
// where localStorage is unavailable or throws.
import { ref } from 'vue'

const KEY_HISTORY = 'nas-bot:search-history'

const HISTORY_CAP = 10

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

export function useSearchHistory() {
  const history = ref<string[]>(readStringArray(KEY_HISTORY))

  function recordQuery(q: string): void {
    const trimmed = q.trim()
    if (!trimmed) return
    // Case-insensitive dedupe: remove any existing entry that matches case-insensitively
    const lower = trimmed.toLowerCase()
    const deduped = history.value.filter((item) => item.toLowerCase() !== lower)
    deduped.unshift(trimmed)
    // Cap at HISTORY_CAP
    history.value = deduped.slice(0, HISTORY_CAP)
    safeSetItem(KEY_HISTORY, JSON.stringify(history.value))
  }

  function clearHistory(): void {
    history.value = []
    safeRemoveItem(KEY_HISTORY)
  }

  return { history, recordQuery, clearHistory }
}
