import type { Subscription } from './subscription.ts'
import {
  buildDigestMessage,
  filterNewEpisodes,
  latestEpisode,
  type DigestEntry,
  type EpisodeFetcher,
} from './digest.ts'

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
 *
 * Each show is fetched exactly ONCE per run; both the message and the
 * lastNotifiedEpisode advance derive from that single snapshot (#289).
 * A show whose fetch yielded nothing (including a swallowed fetch error →
 * empty list) contributes no message line and its pointer is NOT advanced,
 * so its episode is announced on a later run instead of being lost.
 */
export async function runDigest(opts: DigestRunOptions): Promise<void> {
  const { subscriptions, ownerChatId, fetchTodayEpisodes, sendMessage, onSubscriptionUpdated } = opts

  if (!ownerChatId) {
    console.warn('[digest] owner_chat_id not set — skipping digest run')
    return
  }

  const entries: DigestEntry[] = []
  const updatedSubs: Subscription[] = []

  for (const sub of subscriptions) {
    const episodes = await fetchTodayEpisodes(sub.showId)
    const newEps = filterNewEpisodes(episodes, sub.lastNotifiedEpisode)
    if (newEps.length === 0) continue

    entries.push({ title: sub.title, episodes: newEps })
    const latest = latestEpisode(newEps)
    updatedSubs.push({
      ...sub,
      lastNotifiedEpisode: { season: latest.season, episode: latest.episode },
    })
  }

  const message = buildDigestMessage(entries)
  if (!message) return

  await sendMessage(ownerChatId, message)

  // Advance lastNotifiedEpisode only for shows whose episodes were actually
  // included in the sent message (same snapshot as above).
  for (const updated of updatedSubs) {
    await onSubscriptionUpdated(updated)
  }
}

export interface ScheduleDailyDigestOptions {
  runFn: () => Promise<void>
  /** Local hour-of-day (0–23) to fire the digest at. */
  digestHour: number
  /** Last successful run date as YYYY-MM-DD (local time), or undefined if never ran. */
  getLastRunDate: () => string | undefined
  setLastRunDate: (date: string) => void
  /** Injectable clock — defaults to the real one. Tests pass a fake. */
  _now?: () => Date
  /** Injectable timer — defaults to real setTimeout/clearTimeout. Tests pass fakes. */
  _setTimeout?: (fn: () => void, ms: number) => unknown
  _clearTimeout?: (timer: unknown) => void
}

/** Format a Date as YYYY-MM-DD in process-local time (TZ is pinned in deploy). */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Schedule the daily digest at `digestHour:00` process-local time using
 * setTimeout + recalculation. Returns a cleanup function that cancels the
 * pending timer.
 *
 * Persistence (#295): after every successful run the run date is recorded via
 * setLastRunDate (even runs that found nothing — the run happened). On
 * startup, if today's run was missed (last run date ≠ today AND the digest
 * hour already passed), a catch-up run fires immediately. A guard prevents
 * double-running within the same day.
 */
export function scheduleDailyDigest(opts: ScheduleDailyDigestOptions): () => void {
  const {
    runFn,
    digestHour,
    getLastRunDate,
    setLastRunDate,
    _now = () => new Date(),
    _setTimeout = (fn, ms) => setTimeout(fn, ms),
    _clearTimeout = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  } = opts

  let timer: unknown = null
  let cancelled = false

  async function runIfDue(): Promise<void> {
    const today = toLocalDateString(_now())
    if (getLastRunDate() === today) return // already ran today
    await runFn()
    setLastRunDate(today)
  }

  function scheduleNext(): void {
    if (cancelled) return
    const now = _now()
    const next = new Date(now)
    next.setHours(digestHour, 0, 0, 0)
    if (next <= now) {
      // Already past the digest hour today → schedule for tomorrow
      next.setDate(next.getDate() + 1)
    }
    const delay = next.getTime() - now.getTime()

    timer = _setTimeout(() => {
      void (async () => {
        try {
          await runIfDue()
        } catch (err) {
          console.error('[digest] Error during daily digest run:', err)
        }
        scheduleNext()
      })()
    }, delay)
  }

  // Startup catch-up: process was down (or restarting) across the digest hour.
  const now = _now()
  if (now.getHours() >= digestHour && getLastRunDate() !== toLocalDateString(now)) {
    console.log('[digest] missed today\'s run — catching up now')
    runIfDue().catch((err) => console.error('[digest] Error during catch-up digest run:', err))
  }

  scheduleNext()

  return () => {
    cancelled = true
    if (timer !== null) _clearTimeout(timer)
  }
}
