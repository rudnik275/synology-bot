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

  return { subscriptions, subscribedIds, loading, error, refetch, add, remove }
}
