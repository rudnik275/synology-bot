import { describe, it, expect, mock } from 'bun:test'
import { runDigest, scheduleDailyDigest } from '../../../src/domain/digest-scheduler.ts'
import type { Subscription } from '../../../src/domain/subscription.ts'

describe('runDigest — scheduler integration (pure)', () => {
  it('missing owner_chat_id → does not throw, sender never called', async () => {
    const sender = mock(async (_chatId: string, _msg: string) => {})
    await runDigest({
      subscriptions: [{ id: '1', showId: 1, title: 'Breaking Bad' }],
      ownerChatId: undefined,
      fetchTodayEpisodes: async () => [{ season: 1, episode: 1, title: 'Pilot' }],
      sendMessage: sender,
      onSubscriptionUpdated: async () => {},
    })
    expect(sender).not.toHaveBeenCalled()
  })

  it('owner_chat_id present, no episodes → sender never called', async () => {
    const sender = mock(async (_chatId: string, _msg: string) => {})
    await runDigest({
      subscriptions: [{ id: '1', showId: 1, title: 'Breaking Bad' }],
      ownerChatId: '12345',
      fetchTodayEpisodes: async () => [],
      sendMessage: sender,
      onSubscriptionUpdated: async () => {},
    })
    expect(sender).not.toHaveBeenCalled()
  })

  it('owner_chat_id present, new episode → sends digest to owner', async () => {
    const sent: { chatId: string; msg: string }[] = []
    const sender = mock(async (chatId: string, msg: string) => {
      sent.push({ chatId, msg })
    })
    await runDigest({
      subscriptions: [{ id: '1', showId: 1, title: 'Breaking Bad' }],
      ownerChatId: '12345',
      fetchTodayEpisodes: async () => [{ season: 5, episode: 14, title: 'Ozymandias' }],
      sendMessage: sender,
      onSubscriptionUpdated: async () => {},
    })
    expect(sender).toHaveBeenCalledTimes(1)
    expect(sent[0].chatId).toBe('12345')
    expect(sent[0].msg).toContain('Breaking Bad')
    expect(sent[0].msg).toContain('S05E14')
  })

  it('owner_chat_id present, already-notified episode → no message', async () => {
    const sender = mock(async (_chatId: string, _msg: string) => {})
    const subs: Subscription[] = [
      { id: '1', showId: 1, title: 'Breaking Bad', lastNotifiedEpisode: { season: 5, episode: 14 } },
    ]
    await runDigest({
      subscriptions: subs,
      ownerChatId: '12345',
      fetchTodayEpisodes: async () => [{ season: 5, episode: 14, title: 'Ozymandias' }],
      sendMessage: sender,
      onSubscriptionUpdated: async () => {},
    })
    expect(sender).not.toHaveBeenCalled()
  })

  it('new episode → onSubscriptionUpdated called with updated lastNotifiedEpisode', async () => {
    const updates: Subscription[] = []
    const sender = mock(async (_chatId: string, _msg: string) => {})
    const subs: Subscription[] = [{ id: '1', showId: 1, title: 'Breaking Bad' }]

    await runDigest({
      subscriptions: subs,
      ownerChatId: '99999',
      fetchTodayEpisodes: async () => [{ season: 5, episode: 14, title: 'Ozymandias' }],
      sendMessage: sender,
      onSubscriptionUpdated: async (s) => { updates.push(s) },
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].lastNotifiedEpisode).toEqual({ season: 5, episode: 14 })
  })

  // #289: single snapshot per run
  it('fetches each show exactly once per run', async () => {
    const fetchCalls: number[] = []
    const subs: Subscription[] = [
      { id: '1', showId: 1, title: 'Breaking Bad' },
      { id: '2', showId: 2, title: 'The Wire' },
    ]
    await runDigest({
      subscriptions: subs,
      ownerChatId: '12345',
      fetchTodayEpisodes: async (showId) => {
        fetchCalls.push(showId)
        return [{ season: 1, episode: 1, title: 'Pilot' }]
      },
      sendMessage: async () => {},
      onSubscriptionUpdated: async () => {},
    })
    expect(fetchCalls).toEqual([1, 2])
  })

  it('failed fetch (empty result) for one show → its pointer not advanced, other show still announced', async () => {
    const updates: Subscription[] = []
    const sent: string[] = []
    const subs: Subscription[] = [
      { id: '1', showId: 1, title: 'Breaking Bad', lastNotifiedEpisode: { season: 5, episode: 13 } },
      { id: '2', showId: 2, title: 'The Wire' },
    ]
    await runDigest({
      subscriptions: subs,
      ownerChatId: '12345',
      // show 1's fetch "failed" (myshows client swallows errors → [])
      fetchTodayEpisodes: async (showId) =>
        showId === 2 ? [{ season: 3, episode: 12, title: 'Ep' }] : [],
      sendMessage: async (_chatId, msg) => { sent.push(msg) },
      onSubscriptionUpdated: async (s) => { updates.push(s) },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('The Wire')
    expect(sent[0]).not.toContain('Breaking Bad')
    // Only The Wire's pointer advances — Breaking Bad stays at S05E13 so its
    // episode is announced on a later run instead of being lost.
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('2')
    expect(updates[0].lastNotifiedEpisode).toEqual({ season: 3, episode: 12 })
  })

  it('message matches the same snapshot that advances the pointer', async () => {
    const updates: Subscription[] = []
    const sent: string[] = []
    let calls = 0
    await runDigest({
      subscriptions: [{ id: '1', showId: 1, title: 'Breaking Bad' }],
      ownerChatId: '12345',
      // Mutating fetcher: a second fetch would see a different episode. With a
      // single snapshot the message and the pointer must both be S05E14.
      fetchTodayEpisodes: async () => {
        calls++
        return calls === 1
          ? [{ season: 5, episode: 14, title: 'Ozymandias' }]
          : [{ season: 5, episode: 15, title: 'Granite State' }]
      },
      sendMessage: async (_chatId, msg) => { sent.push(msg) },
      onSubscriptionUpdated: async (s) => { updates.push(s) },
    })
    expect(calls).toBe(1)
    expect(sent[0]).toContain('S05E14')
    expect(sent[0]).not.toContain('S05E15')
    expect(updates[0].lastNotifiedEpisode).toEqual({ season: 5, episode: 14 })
  })
})

describe('scheduleDailyDigest — timer + persisted last-run date', () => {
  interface FakeTimer {
    fn: () => void
    ms: number
    cleared: boolean
  }

  function makeHarness(opts: {
    now: Date
    lastRunDate?: string
    digestHour?: number
    runFn?: () => Promise<void>
  }) {
    const timers: FakeTimer[] = []
    let now = opts.now
    let lastRunDate = opts.lastRunDate
    const runs: Date[] = []
    const runFn = opts.runFn ?? (async () => { runs.push(now) })

    const cancel = scheduleDailyDigest({
      runFn,
      digestHour: opts.digestHour ?? 9,
      getLastRunDate: () => lastRunDate,
      setLastRunDate: (date) => { lastRunDate = date },
      _now: () => now,
      _setTimeout: (fn, ms) => {
        const t: FakeTimer = { fn, ms, cleared: false }
        timers.push(t)
        return t
      },
      _clearTimeout: (t) => { (t as FakeTimer).cleared = true },
    })

    return {
      timers,
      runs,
      cancel,
      getLastRunDate: () => lastRunDate,
      setNow: (d: Date) => { now = d },
      /** Fire the most recent pending timer and let async work settle. */
      async fireLastTimer() {
        timers[timers.length - 1].fn()
        await Bun.sleep(0)
      },
      async settle() {
        await Bun.sleep(0)
      },
    }
  }

  it('schedules next run at the digest hour (respects digestHour param)', async () => {
    const h = makeHarness({
      now: new Date('2026-06-10T07:00:00'),
      digestHour: 12,
      lastRunDate: '2026-06-10',
    })
    await h.settle()
    expect(h.runs).toHaveLength(0) // before digest hour → no catch-up
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0].ms).toBe(5 * 60 * 60 * 1000) // 07:00 → 12:00
    h.cancel()
  })

  it('past the digest hour with stale last_run_date → catch-up runs immediately', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T10:30:00'), lastRunDate: '2026-06-09' })
    await h.settle()
    expect(h.runs).toHaveLength(1)
    expect(h.getLastRunDate()).toBe('2026-06-10')
    // Next timer is for tomorrow 09:00
    expect(h.timers[0].ms).toBe(22.5 * 60 * 60 * 1000)
    h.cancel()
  })

  it('never ran before (no last_run_date) and past the hour → catch-up runs', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T09:01:00') })
    await h.settle()
    expect(h.runs).toHaveLength(1)
    expect(h.getLastRunDate()).toBe('2026-06-10')
    h.cancel()
  })

  it('already ran today → no catch-up, no double-run', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T10:30:00'), lastRunDate: '2026-06-10' })
    await h.settle()
    expect(h.runs).toHaveLength(0)
    h.cancel()
  })

  it('before the digest hour with stale date → no catch-up; timer fires and records the date', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T08:00:00'), lastRunDate: '2026-06-09' })
    await h.settle()
    expect(h.runs).toHaveLength(0)
    expect(h.timers[0].ms).toBe(60 * 60 * 1000) // fires at 09:00 today

    h.setNow(new Date('2026-06-10T09:00:00'))
    await h.fireLastTimer()
    expect(h.runs).toHaveLength(1)
    expect(h.getLastRunDate()).toBe('2026-06-10')
    // Rescheduled for tomorrow
    expect(h.timers).toHaveLength(2)
    expect(h.timers[1].ms).toBe(24 * 60 * 60 * 1000)
    h.cancel()
  })

  it('timer fires but run already happened today → skipped (guard against double-run)', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T08:00:00'), lastRunDate: '2026-06-10' })
    await h.settle()
    h.setNow(new Date('2026-06-10T09:00:00'))
    await h.fireLastTimer()
    expect(h.runs).toHaveLength(0)
    expect(h.timers).toHaveLength(2) // still reschedules for tomorrow
    h.cancel()
  })

  it('failed run → date NOT recorded, stays eligible for catch-up', async () => {
    const h = makeHarness({
      now: new Date('2026-06-10T08:00:00'),
      lastRunDate: '2026-06-09',
      runFn: async () => { throw new Error('boom') },
    })
    await h.settle()
    h.setNow(new Date('2026-06-10T09:00:00'))
    await h.fireLastTimer()
    expect(h.getLastRunDate()).toBe('2026-06-09') // unchanged
    expect(h.timers).toHaveLength(2) // error swallowed, loop continues
    h.cancel()
  })

  it('cancel clears the pending timer', async () => {
    const h = makeHarness({ now: new Date('2026-06-10T08:00:00'), lastRunDate: '2026-06-10' })
    await h.settle()
    h.cancel()
    expect(h.timers[0].cleared).toBe(true)
  })
})
