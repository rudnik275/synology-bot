import { ref, onUnmounted, getCurrentInstance } from 'vue'
import { api } from '../api'
import type { ShowSearchResultView } from '../types'

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

/**
 * Composable for live show search (ADR 0009).
 *
 * Debounces the query (~300 ms), requires ≥2 chars to start searching.
 * While query is empty the tab shows the Subscriptions list instead.
 */
export function useShowSearch() {
  const results = ref<ShowSearchResultView[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  // Monotonic sequence guard: only the latest search() call may write state.
  // Prevents a slow earlier request from overwriting a newer query's results.
  let latest = 0

  // Clear timer on unmount to prevent stale re-renders after tests.
  if (getCurrentInstance()) {
    onUnmounted(() => {
      destroyed = true
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    })
  }

  async function search(query: string): Promise<void> {
    if (destroyed) return
    if (query.length < MIN_QUERY_LENGTH) {
      results.value = []
      loading.value = false
      error.value = null
      return
    }

    const seq = ++latest
    loading.value = true
    error.value = null

    try {
      const data = await api.searchShows(query)
      if (destroyed || seq !== latest) return
      results.value = data
    } catch (e) {
      if (destroyed || seq !== latest) return
      error.value = e instanceof Error ? e.message : String(e)
      results.value = []
    } finally {
      if (!destroyed && seq === latest) loading.value = false
    }
  }

  function debouncedSearch(query: string): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    if (query.length < MIN_QUERY_LENGTH) {
      results.value = []
      loading.value = false
      error.value = null
      return
    }
    loading.value = true
    debounceTimer = setTimeout(() => {
      void search(query)
    }, DEBOUNCE_MS)
  }

  return { results, loading, error, debouncedSearch }
}
