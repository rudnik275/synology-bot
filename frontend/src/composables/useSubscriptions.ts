import { computed } from 'vue'
import { useApi } from './useApi'
import { api } from '../api'
import type { SubscriptionView, TodayEpisodeView } from '../types'

/**
 * Domain composable for the Shows tab: lists subscriptions and today's airing
 * episodes, and exposes add/remove mutations that refetch after each change.
 *
 * Built on useApi (GET only); mutations delegate to src/api.ts.
 */
export function useSubscriptions() {
  const subsApi = useApi<{ subscriptions: SubscriptionView[] }>('/subscriptions')
  const todayApi = useApi<{ episodes: TodayEpisodeView[] }>('/subscriptions/today')

  const subscriptions = computed<SubscriptionView[]>(() => subsApi.data.value?.subscriptions ?? [])
  const todayEpisodes = computed<TodayEpisodeView[]>(() => todayApi.data.value?.episodes ?? [])

  // loading = either endpoint is in-flight
  const loading = computed(() => subsApi.loading.value || todayApi.loading.value)

  // surface the first error from either endpoint
  const error = computed(() => subsApi.error.value ?? todayApi.error.value)

  async function refetch(): Promise<void> {
    await Promise.all([subsApi.refetch(), todayApi.refetch()])
  }

  async function add(showId: number): Promise<void> {
    await api.subscribe(showId)
    await refetch()
  }

  async function remove(id: string): Promise<void> {
    await api.unsubscribe(id)
    await refetch()
  }

  return { subscriptions, todayEpisodes, loading, error, refetch, add, remove }
}
