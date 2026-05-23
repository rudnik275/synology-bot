import { describe, it, expect, beforeEach } from 'bun:test'
import { Notifier } from '../../../../src/domain/notifier/notifier.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

// --- Fake store ---
class FakeStore {
  private kv = new Map<string, string>()

  getKv(key: string): string | undefined {
    return this.kv.get(key)
  }

  setKv(key: string, value: string): void {
    this.kv.set(key, value)
  }
}

// --- Fake sender ---
type SentMessage = { chatId: number; text: string }

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'My Movie.mkv',
    status: 'finished',
    size: 2_000_000_000,
    additional: {
      detail: { destination: '/volume1/downloads' },
    },
    ...overrides,
  }
}

describe('Notifier', () => {
  let store: FakeStore
  let sent: SentMessage[]
  let notifier: Notifier

  beforeEach(() => {
    store = new FakeStore()
    sent = []
    notifier = new Notifier(
      store as any,
      async (chatId, text) => { sent.push({ chatId, text }) }
    )
  })

  // --- Cycle 1: successful notification ---
  it('sends message to owner_chat_id on task finished', async () => {
    store.setKv('owner_chat_id', '123456')
    await notifier.notify(makeTask())
    expect(sent).toHaveLength(1)
    expect(sent[0].chatId).toBe(123456)
    expect(sent[0].text).toContain('My Movie.mkv')
  })

  it('message text includes ✅ prefix', async () => {
    store.setKv('owner_chat_id', '999')
    await notifier.notify(makeTask())
    expect(sent[0].text).toMatch(/^✅/)
  })

  it('message text includes destination folder when present', async () => {
    store.setKv('owner_chat_id', '999')
    await notifier.notify(makeTask())
    expect(sent[0].text).toContain('/volume1/downloads')
  })

  it('message omits folder line when destination is missing', async () => {
    store.setKv('owner_chat_id', '999')
    const task = makeTask({ additional: {} })
    await notifier.notify(task)
    // Should not crash, title still present
    expect(sent[0].text).toContain('My Movie.mkv')
  })

  // --- Cycle 2: missing owner_chat_id ---
  it('does NOT crash and does NOT send message when owner_chat_id is not set', async () => {
    // no store.setKv('owner_chat_id', ...) call
    await expect(notifier.notify(makeTask())).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // --- Cycle 3: send is called with correct numeric chatId ---
  it('converts owner_chat_id string to number', async () => {
    store.setKv('owner_chat_id', '7777777')
    await notifier.notify(makeTask())
    expect(typeof sent[0].chatId).toBe('number')
    expect(sent[0].chatId).toBe(7777777)
  })
})
