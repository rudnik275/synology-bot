/**
 * Shows routes: search and detail (ADR 0009).
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { MyShowsShowDetailed, MyShowsSearchResult } from '../../infra/myshows/client.ts'
import { refreshSubscriptionMetadata } from '../../domain/subscription-metadata-refresh.ts'
import { tryResult } from '../../lib/result.ts'
import { respondResult } from '../respond.ts'
import { serializeShowSearchResult, serializeShowDetail } from '../serializers.ts'
import type { SubscriptionStore } from '../server.ts'

export interface ShowRouteDeps {
  store: SubscriptionStore
  getShowById: (showId: number) => Promise<MyShowsShowDetailed>
  searchShows: (query: string) => Promise<MyShowsSearchResult[]>
}

export function registerShowRoutes(app: Hono<AppEnv>, deps: ShowRouteDeps): void {
  const { store, getShowById, searchShows } = deps

  app.get('/api/shows/search', async (c) => {
    const q = c.req.query('q')?.trim()
    if (!q) return c.json({ error: 'q is required' }, 400)
    const r = await tryResult(() => searchShows(q))
    if (!r.ok) return respondResult(c, r)
    const subscribedIds = new Set(store.listSubscriptions().map((s) => s.showId))
    return c.json({ results: r.data.map((s) => serializeShowSearchResult(s, subscribedIds)) })
  })

  app.get('/api/shows/:id', async (c) => {
    const showId = Number(c.req.param('id'))
    if (!Number.isInteger(showId) || showId <= 0) {
      return c.json({ error: 'showId must be a positive integer' }, 400)
    }

    const r = await tryResult(() => getShowById(showId))
    if (!r.ok) return respondResult(c, r)
    const show = r.data

    const subscribedIds = new Set(store.listSubscriptions().map((s) => s.showId))

    // Self-heal: if the show is subscribed, stamp updated poster + latestAiredEpisode into the store.
    const existingSub = store.getSubscription(String(showId))
    if (existingSub) {
      try {
        const [refreshed] = await refreshSubscriptionMetadata([existingSub], async () => ({
          poster: show.image,
          episodes: show.episodes,
        }), new Date())
        if (refreshed) store.addSubscription(refreshed)
      } catch {
        // Non-fatal: self-heal failure should not block the detail response.
      }
    }

    return c.json(serializeShowDetail(show, subscribedIds, new Date()))
  })
}
