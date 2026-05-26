import { describe, it, expect } from 'bun:test'
import { GrammyError } from 'grammy'
import { bootstrapTopics, type TopicBootstrapStore } from '../../../../src/infra/notify/topic-bootstrap.ts'
import { CATEGORIES, type Category } from '../../../../src/infra/notify/categories.ts'

class FakeStore implements TopicBootstrapStore {
  threads = new Map<Category, number>()
  disabled = false
  getTopicThreadId(category: Category) { return this.threads.get(category) }
  setTopicThreadId(category: Category, threadId: number) { this.threads.set(category, threadId) }
  areTopicsDisabled() { return this.disabled }
  setTopicsDisabled() { this.disabled = true }
}

function makeFakeBot(opts: {
  onCreate?: (chatId: number, name: string) => Promise<{ message_thread_id: number }>
} = {}) {
  const calls: Array<{ chatId: number; name: string }> = []
  const onCreate = opts.onCreate ?? (async (_chatId, name) => ({
    message_thread_id: 100 + name.length, // deterministic-ish id
  }))
  const bot = {
    api: {
      createForumTopic: async (chatId: number, name: string, _opts?: unknown) => {
        calls.push({ chatId, name })
        return onCreate(chatId, name)
      },
    },
  } as unknown as Parameters<typeof bootstrapTopics>[0]
  return { bot, calls }
}

function clientError(code: number, desc: string): GrammyError {
  return new GrammyError(
    'Call failed',
    { ok: false, error_code: code, description: desc },
    'createForumTopic',
    {}
  )
}

describe('bootstrapTopics', () => {
  it('creates all four topics on first run and persists their thread ids', async () => {
    const store = new FakeStore()
    const { bot, calls } = makeFakeBot()

    const result = await bootstrapTopics(bot, 555, store)

    expect(calls).toHaveLength(CATEGORIES.length)
    expect(calls.map((c) => c.name)).toEqual(CATEGORIES.map((c) => c.name))
    expect(calls.every((c) => c.chatId === 555)).toBe(true)
    expect(result.created.length).toBe(CATEGORIES.length)
    expect(result.skipped).toHaveLength(0)
    expect(result.disabled).toBe(false)
    for (const cat of CATEGORIES) {
      expect(store.getTopicThreadId(cat.key)).toBeDefined()
    }
  })

  it('is idempotent — skips categories that already have thread ids', async () => {
    const store = new FakeStore()
    store.setTopicThreadId('torrents', 42)
    store.setTopicThreadId('health', 43)
    const { bot, calls } = makeFakeBot()

    const result = await bootstrapTopics(bot, 555, store)

    expect(calls.map((c) => c.name)).toEqual(['Деплой', 'Подписки'])
    expect(result.skipped).toEqual(['torrents', 'health'])
    expect(result.created).toEqual(['deploy', 'subscriptions'])
    expect(store.getTopicThreadId('torrents')).toBe(42)
  })

  it('does nothing when topics are already disabled', async () => {
    const store = new FakeStore()
    store.disabled = true
    const { bot, calls } = makeFakeBot()

    const result = await bootstrapTopics(bot, 555, store)

    expect(calls).toHaveLength(0)
    expect(result.disabled).toBe(true)
    expect(result.created).toHaveLength(0)
  })

  it('sets topics_disabled and gives up on a Telegram 400 error', async () => {
    const store = new FakeStore()
    const { bot, calls } = makeFakeBot({
      onCreate: async (_chatId, name) => {
        if (name === 'Состояние NAS') {
          throw clientError(400, 'TOPIC_CREATION_DISABLED')
        }
        return { message_thread_id: 7 }
      },
    })

    const result = await bootstrapTopics(bot, 555, store)

    expect(store.areTopicsDisabled()).toBe(true)
    expect(result.disabled).toBe(true)
    expect(result.created).toEqual(['torrents'])
    expect(calls.map((c) => c.name)).toEqual(['Торренты', 'Состояние NAS'])
    expect(store.getTopicThreadId('deploy')).toBeUndefined()
  })

  it('rethrows non-Telegram errors so caller can retry', async () => {
    const store = new FakeStore()
    const { bot } = makeFakeBot({
      onCreate: async () => { throw new Error('network down') },
    })

    await expect(bootstrapTopics(bot, 555, store)).rejects.toThrow('network down')
    expect(store.areTopicsDisabled()).toBe(false)
  })

  it('rethrows on 5xx (transient server error)', async () => {
    const store = new FakeStore()
    const { bot } = makeFakeBot({
      onCreate: async () => { throw clientError(500, 'Internal error') },
    })

    await expect(bootstrapTopics(bot, 555, store)).rejects.toThrow()
    expect(store.areTopicsDisabled()).toBe(false)
  })
})
