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
   * set on failure, and stale data is preserved on failure. A SUCCESSFUL
   * background fetch still updates data and clears any prior error. Used by
   * the poll timer so background ticks don't cause skeleton/empty-state
   * flicker.
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

  // Monotonic sequence guard: a background poll and a foreground refetch can be
  // in flight at once (useTasks refetches after pause/resume/delete while the
  // 3s poll timer ticks). Only the latest-issued request may write state on
  // settle — a slow stale response is discarded so it can't overwrite fresher
  // data (e.g. resurrecting a just-deleted task card).
  let latest = 0
  // Separate counter for loading: a newer background poll must not stop a
  // settling foreground fetch from clearing the spinner it turned on.
  let latestForeground = 0

  async function refetch(opts?: RefetchOptions): Promise<void> {
    const background = opts?.background ?? false
    const seq = ++latest
    if (!background) {
      latestForeground = seq
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
      const parsed = (await res.json()) as T
      if (seq !== latest) return // stale response — a newer refetch owns the state
      data.value = parsed
      // Any successful fetch (background included) clears a previously-set
      // error: once fresh data arrives the error state is no longer true.
      error.value = null
    } catch (e) {
      if (seq !== latest) return // stale response — discard entirely
      if (!background) {
        error.value = e instanceof Error ? e.message : String(e)
      }
      // Background failure: keep stale data and prior error state intact
    } finally {
      if (!background && seq === latestForeground) {
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
