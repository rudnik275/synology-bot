import { ref } from 'vue'
import { api } from '../api'
import type { ShowDetailView } from '../types'

/**
 * Composable for fetching the detail view of a Show (ADR 0009).
 * Fetches /api/shows/:id; the endpoint also performs the self-heal write.
 */
export function useShowDetail() {
  const data = ref<ShowDetailView | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(showId: number): Promise<void> {
    loading.value = true
    error.value = null
    data.value = null
    try {
      data.value = await api.getShow(showId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function clear(): void {
    data.value = null
    error.value = null
    loading.value = false
  }

  return { data, loading, error, load, clear }
}
