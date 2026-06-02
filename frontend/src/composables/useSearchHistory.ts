// Composable for search history: persists recent search queries (MRU).
//
// Source of truth is the backend (#4) — Telegram WebView localStorage is wiped
// between sessions/redeploys (esp. iOS), which is why "recent searches" kept
// vanishing. localStorage stays as an instant-paint cache and the sole store in
// a bare browser / tests; backend sync only runs inside Telegram.
import { ref } from 'vue'
import { api } from '../api'
import { inTelegram } from '../telegram'

const UI_KEY = 'search-history'

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

  // Hydrate from the backend (the cross-session source of truth). If the backend
  // has nothing yet but the local cache does, seed the backend from the cache.
  if (inTelegram) {
    api
      .uiState(UI_KEY)
      .then((values) => {
        if (values.length > 0) {
          history.value = values
          safeSetItem(KEY_HISTORY, JSON.stringify(values))
        } else if (history.value.length > 0) {
          void api.setUiState(UI_KEY, history.value).catch(() => {})
        }
      })
      .catch(() => {})
  }

  function persist(): void {
    safeSetItem(KEY_HISTORY, JSON.stringify(history.value))
    if (inTelegram) void api.setUiState(UI_KEY, history.value).catch(() => {})
  }

  function recordQuery(q: string): void {
    const trimmed = q.trim()
    if (!trimmed) return
    // Case-insensitive dedupe: remove any existing entry that matches case-insensitively
    const lower = trimmed.toLowerCase()
    const deduped = history.value.filter((item) => item.toLowerCase() !== lower)
    deduped.unshift(trimmed)
    // Cap at HISTORY_CAP
    history.value = deduped.slice(0, HISTORY_CAP)
    persist()
  }

  function clearHistory(): void {
    history.value = []
    safeRemoveItem(KEY_HISTORY)
    if (inTelegram) void api.setUiState(UI_KEY, []).catch(() => {})
  }

  return { history, recordQuery, clearHistory }
}
