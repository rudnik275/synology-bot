import type { Subscription } from './subscription.ts'
import { buildDigestMessage, type AiringEpisode, type EpisodeFetcher } from './digest.ts'

export interface DigestRunOptions {
  subscriptions: Subscription[]
  ownerChatId: string | undefined
  fetchTodayEpisodes: EpisodeFetcher
  sendMessage: (chatId: string, message: string) => Promise<void>
  onSubscriptionUpdated: (subscription: Subscription) => Promise<void>
}

/**
 * Execute one digest run (pure-ish — side effects are injected).
 * If ownerChatId is missing, silently skips (logs warning).
 * For each subscription with a new episode, updates lastNotifiedEpisode.
 */
export async function runDigest(opts: DigestRunOptions): Promise<void> {
  const { subscriptions, ownerChatId, fetchTodayEpisodes, sendMessage, onSubscriptionUpdated } = opts

  if (!ownerChatId) {
    console.warn('[digest] owner_chat_id not set — skipping digest run')
    return
  }

  // Track which subscriptions got new episodes so we can update them
  const updatedSubs: Subscription[] = []

  // Wrap fetcher to also track which episodes were included per subscription
  const trackingFetcher = (showId: number) => fetchTodayEpisodes(showId)

  // We need to know which episodes were actually included per sub.
  // Re-implement inline so we can update lastNotifiedEpisode per show.
  for (const sub of subscriptions) {
    const episodes = await fetchTodayEpisodes(sub.showId)
    const newEps: AiringEpisode[] = []

    for (const ep of episodes) {
      const last = sub.lastNotifiedEpisode
      if (last) {
        const same = ep.season === last.season && ep.episode === last.episode
        const isAfter =
          ep.season > last.season || (ep.season === last.season && ep.episode > last.episode)
        if (!isAfter || same) continue
      }
      newEps.push(ep)
    }

    if (newEps.length > 0) {
      // Pick the latest episode (highest season/episode) for lastNotifiedEpisode
      const latest = newEps.reduce((best, ep) => {
        if (ep.season > best.season) return ep
        if (ep.season === best.season && ep.episode > best.episode) return ep
        return best
      })
      updatedSubs.push({
        ...sub,
        lastNotifiedEpisode: { season: latest.season, episode: latest.episode },
      })
    }
  }

  if (updatedSubs.length === 0) {
    return
  }

  // Build the digest message using the updated subscriptions' episodes
  // Re-use buildDigestMessage with a fetcher that returns only new episodes
  const message = await buildDigestMessage(
    subscriptions,
    trackingFetcher
  )

  if (!message) return

  await sendMessage(ownerChatId, message)

  // Update lastNotifiedEpisode for each show that had new episodes
  for (const updated of updatedSubs) {
    await onSubscriptionUpdated(updated)
  }
}

/**
 * Schedule daily digest at 09:00 server time using setTimeout + recalculation.
 * Returns a cleanup function that cancels pending timer.
 */
export function scheduleDailyDigest(
  runFn: () => Promise<void>
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  function scheduleNext(): void {
    const now = new Date()
    const next = new Date(now)
    next.setHours(9, 0, 0, 0)
    if (next <= now) {
      // Already past 9 AM today → schedule for tomorrow
      next.setDate(next.getDate() + 1)
    }
    const delay = next.getTime() - now.getTime()

    timer = setTimeout(async () => {
      try {
        await runFn()
      } catch (err) {
        console.error('[digest] Error during daily digest run:', err)
      }
      scheduleNext()
    }, delay)
  }

  scheduleNext()

  return () => {
    if (timer !== null) clearTimeout(timer)
  }
}
