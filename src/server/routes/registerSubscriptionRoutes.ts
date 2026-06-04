/**
 * Subscription routes: list, add, remove, refresh.
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { Subscription } from '../../domain/subscription.ts'
import type { MyShowsShowDetailed } from '../../infra/myshows/client.ts'
import { refreshSubscriptionMetadata } from '../../domain/subscription-metadata-refresh.ts'
import { tryResult } from '../../lib/result.ts'
import { respondResult } from '../respond.ts'
import { serializeSubscription } from '../serializers.ts'
import type { SubscriptionStore } from '../server.ts'

export interface SubscriptionRouteDeps {
  store: SubscriptionStore
  getShowById: (showId: number) => Promise<MyShowsShowDetailed>
}

export function registerSubscriptionRoutes(app: Hono<AppEnv>, deps: SubscriptionRouteDeps): void {
  const { store, getShowById } = deps

  app.get('/api/subscriptions', (c) =>
    c.json({ subscriptions: store.listSubscriptions().map(serializeSubscription) })
  )

  // Background backfill: refresh poster + latestAiredEpisode for ALL subscriptions
  // from live myshows, so the list self-fills when the Shows tab opens instead of
  // waiting for the daily digest.
  app.post('/api/subscriptions/refresh', async (c) => {
    const refreshed = await refreshSubscriptionMetadata(
      store.listSubscriptions(),
      async (showId) => {
        const show = await getShowById(showId)
        return { poster: show.image, episodes: show.episodes }
      },
      new Date()
    )
    for (const sub of refreshed) store.addSubscription(sub)
    return c.json({ subscriptions: refreshed.map(serializeSubscription) })
  })

  // Retired endpoint — returns 404 to signal removal to any lingering clients.
  app.get('/api/subscriptions/today', (c) => c.json({ error: 'endpoint retired' }, 404))

  app.post('/api/subscriptions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const showId = Number((body as Record<string, unknown> | null)?.showId)
    if (!Number.isInteger(showId)) {
      return c.json({ error: 'showId (integer) is required' }, 400)
    }
    const existing = store.getSubscription(String(showId))
    if (existing) return c.json({ subscription: serializeSubscription(existing) })

    const r = await tryResult(() => getShowById(showId))
    if (!r.ok) return respondResult(c, r)
    const show = r.data
    const sub: Subscription = { id: String(showId), showId, title: show.title, poster: show.image }
    store.addSubscription(sub)
    return c.json({ subscription: serializeSubscription(sub) }, 201)
  })

  app.delete('/api/subscriptions/:id', (c) => {
    const id = c.req.param('id')
    const existing = store.getSubscription(id)
    if (!existing) return c.json({ error: 'not found' }, 404)
    store.removeSubscription(id)
    return c.json({ ok: true })
  })
}
