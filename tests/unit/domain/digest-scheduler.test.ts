import { describe, it, expect, mock } from 'bun:test'
import { runDigest } from '../../../src/domain/digest-scheduler.ts'
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
})
