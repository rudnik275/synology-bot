// Composable for search history: persists recent search queries (MRU).
//
// Source of truth is the backend (#4) — Telegram WebView localStorage is wiped
// between sessions/redeploys (esp. iOS), which is why "recent searches" kept
// vanishing. localStorage stays as an instant-paint cache and the sole store in
// a bare browser / tests; backend sync only runs inside Telegram.
import { ref } from 'vue'
import { syncUiList } from './uiListSync'

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

  // Backend hydration + persistence with the #303 race guard: once a local
  // mutation happened, a still-in-flight hydration GET's payload is discarded.
  const sync = syncUiList({
    list: history,
    uiKey: UI_KEY,
    persistLocal: (values) => safeSetItem(KEY_HISTORY, JSON.stringify(values)),
  })

  function persist(): void {
    safeSetItem(KEY_HISTORY, JSON.stringify(history.value))
    sync.push()
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
    sync.push()
  }

  return { history, recordQuery, clearHistory }
}
