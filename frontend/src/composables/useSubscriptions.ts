import { computed } from 'vue'
import { useApi } from './useApi'
import { api } from '../api'
import type { SubscriptionView } from '../types'

/**
 * Domain composable for the Shows tab: lists subscriptions and exposes
 * add/remove mutations that refetch after each change.
 *
 * ADR 0009: `todayEpisodes` is removed; `subscribedIds` is added for the
 * search-result *Subscribed* marker.
 *
 * Built on useApi (GET only); mutations delegate to src/api.ts.
 */
export function useSubscriptions() {
  const subsApi = useApi<{ subscriptions: SubscriptionView[] }>('/subscriptions')

  const subscriptions = computed<SubscriptionView[]>(() => subsApi.data.value?.subscriptions ?? [])

  /** Set of subscribed showIds for O(1) lookup in search results. */
  const subscribedIds = computed<Set<number>>(() => new Set(subscriptions.value.map((s) => s.showId)))

  const loading = computed(() => subsApi.loading.value)
  const error = computed(() => subsApi.error.value)

  async function refetch(): Promise<void> {
    await subsApi.refetch()
  }

  async function add(showId: number): Promise<void> {
    await api.subscribe(showId)
    await refetch()
  }

  async function remove(id: string): Promise<void> {
    await api.unsubscribe(id)
    await refetch()
  }

  /**
   * Background backfill: ask the server to stamp poster + latestAiredEpisode for
   * all subscriptions from live myshows, then refetch so the list self-fills.
   * Best-effort — the cached list stays usable if it fails. Called on Shows-tab
   * open so pre-existing subs don't sit empty until the daily digest runs.
   *
   * Uses { background: true } so loading never toggles to true: the list stays
   * mounted and the TransitionGroup is not unmounted/remounted, preventing the
   * appear-animation scroll-reset bug (#17).
   */
  async function refreshMetadata(): Promise<void> {
    try {
      await api.refreshSubscriptions()
      await subsApi.refetch({ background: true })
    } catch {
      // best-effort backfill; keep the cached list as-is on failure
    }
  }

  return { subscriptions, subscribedIds, loading, error, refetch, add, remove, refreshMetadata }
}
