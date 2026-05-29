import { ref, onMounted, onUnmounted, getCurrentInstance, type Ref } from 'vue'
import { initData } from '../telegram'

/**
 * Base data composable: a reactive GET against the Mini App `/api`, with the
 * `Authorization: tma <initData>` header injected for the initData-HMAC middleware.
 *
 * This is the seam every tab's data composable (useHealth / useTasks /
 * useSubscriptions) is built on — they call useApi with their path and shape T,
 * then layer domain logic on top. Mutations (POST/DELETE) live in src/api.ts.
 */

export interface UseApiOptions {
  /** Fetch immediately on mount. Default true. */
  immediate?: boolean
  /** Poll interval in ms. When > 0, refetch on a timer while mounted. */
  pollMs?: number
}

export interface RefetchOptions {
  /**
   * When true the fetch runs silently: loading is not toggled, error is not
   * cleared/set, and stale data is preserved on failure. Used by the poll
   * timer so background ticks don't cause skeleton/empty-state flicker.
   */
  background?: boolean
}

export interface UseApi<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  refetch: (opts?: RefetchOptions) => Promise<void>
}

export function useApi<T>(path: string, options: UseApiOptions = {}): UseApi<T> {
  const { immediate = true, pollMs = 0 } = options

  const data = ref(null) as Ref<T | null>
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refetch(opts?: RefetchOptions): Promise<void> {
    const background = opts?.background ?? false
    if (!background) {
      loading.value = true
      error.value = null
    }
    try {
      const res = await fetch(`/api${path}`, {
        headers: { Authorization: `tma ${initData}` },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      data.value = (await res.json()) as T
    } catch (e) {
      if (!background) {
        error.value = e instanceof Error ? e.message : String(e)
      }
      // Background failure: keep stale data and prior error state intact
    } finally {
      if (!background) {
        loading.value = false
      }
    }
  }

  // Lifecycle wiring only runs inside a component setup(); guarding lets the
  // composable also be driven manually (e.g. in tests) via refetch().
  if (getCurrentInstance()) {
    let timer: ReturnType<typeof setInterval> | undefined

    onMounted(() => {
      if (immediate) void refetch()
      if (pollMs > 0) timer = setInterval(() => void refetch({ background: true }), pollMs)
    })

    onUnmounted(() => {
      if (timer) clearInterval(timer)
    })
  }

  return { data, loading, error, refetch }
}
