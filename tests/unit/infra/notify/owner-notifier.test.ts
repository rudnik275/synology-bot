import { describe, it, expect } from 'bun:test'
import { OwnerNotifier, type LowLevelSend } from '../../../../src/infra/notify/owner-notifier.ts'

function makeOwner(kvSeed: Record<string, string> = {}) {
  const kv = new Map(Object.entries(kvSeed))
  const sent: Array<Parameters<LowLevelSend>[0]> = []
  const owner = new OwnerNotifier(
    { getKv: (key) => kv.get(key) },
    async (p) => { sent.push(p) }
  )
  return { owner, sent, kv }
}

describe('OwnerNotifier', () => {
  it('drops messages when owner_chat_id is not set', async () => {
    const { owner, sent } = makeOwner()
    await owner.send('torrents', 'hi')
    expect(sent).toHaveLength(0)
  })

  it('routes to the right thread for a category with stored thread id', async () => {
    const { owner, sent } = makeOwner({
      owner_chat_id: '100',
      'topic_thread_id:health': '7',
    })
    await owner.send('health', 'disk warning')
    expect(sent[0].chatId).toBe(100)
    expect(sent[0].messageThreadId).toBe(7)
  })

  it('routes to flat chat when category has no thread id', async () => {
    const { owner, sent } = makeOwner({ owner_chat_id: '100' })
    await owner.send('torrents', 'finished')
    expect(sent[0].messageThreadId).toBeUndefined()
  })

  it('ignores thread ids when topics_disabled is set', async () => {
    const { owner, sent } = makeOwner({
      owner_chat_id: '100',
      'topic_thread_id:torrents': '5',
      topics_disabled: '1',
    })
    await owner.send('torrents', 'finished')
    expect(sent[0].messageThreadId).toBeUndefined()
  })

  it('passes replyMarkup through unchanged', async () => {
    const { owner, sent } = makeOwner({ owner_chat_id: '100' })
    const replyMarkup = { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] }
    await owner.send('torrents', 'pick', { replyMarkup })
    expect(sent[0].replyMarkup).toEqual(replyMarkup)
  })

  it('different categories resolve independently', async () => {
    const { owner, sent } = makeOwner({
      owner_chat_id: '100',
      'topic_thread_id:torrents': '1',
      'topic_thread_id:health': '2',
      'topic_thread_id:deploy': '3',
      'topic_thread_id:subscriptions': '4',
    })
    await owner.send('torrents', 'a')
    await owner.send('health', 'b')
    await owner.send('deploy', 'c')
    await owner.send('subscriptions', 'd')
    expect(sent.map((s) => s.messageThreadId)).toEqual([1, 2, 3, 4])
  })
})
