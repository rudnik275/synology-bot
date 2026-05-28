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

  it('sends to the owner flat chat regardless of category', async () => {
    const { owner, sent } = makeOwner({ owner_chat_id: '100' })
    await owner.send('health', 'disk warning')
    await owner.send('torrents', 'finished')
    expect(sent.map((s) => s.chatId)).toEqual([100, 100])
    expect(sent.map((s) => s.text)).toEqual(['disk warning', 'finished'])
  })

  it('passes replyMarkup through unchanged', async () => {
    const { owner, sent } = makeOwner({ owner_chat_id: '100' })
    const replyMarkup = { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] }
    await owner.send('torrents', 'pick', { replyMarkup })
    expect(sent[0].replyMarkup).toEqual(replyMarkup)
  })
})
