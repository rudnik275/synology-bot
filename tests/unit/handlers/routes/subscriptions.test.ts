import { describe, it, expect, mock } from 'bun:test'
import { registerSubscriptionRoutes } from '../../../../src/handlers/routes/subscriptions.ts'
import type { PersistentStore } from '../../../../src/infra/persistence/store.ts'
import type { Subscription } from '../../../../src/domain/subscription.ts'

// ---- Minimal grammy stubs ----

interface FakeCtx {
  message?: { text?: string }
  reply: ReturnType<typeof mock>
}

type CommandHandler = (ctx: FakeCtx) => Promise<void>

function makeFakeBot() {
  const commands = new Map<string, CommandHandler>()
  return {
    command(name: string, handler: CommandHandler) {
      commands.set(name, handler)
    },
    async trigger(name: string, ctx: FakeCtx) {
      const handler = commands.get(name)
      if (!handler) throw new Error(`No handler for /${name}`)
      await handler(ctx)
    },
  }
}

function makeStore(subs: Subscription[]): PersistentStore {
  return {
    listSubscriptions: () => subs,
    getSubscription: () => undefined,
    addSubscription: () => {},
    removeSubscription: () => {},
  } as unknown as PersistentStore
}

describe('/subscriptions list', () => {
  it('lists all subscriptions when short', async () => {
    const bot = makeFakeBot()
    registerSubscriptionRoutes(bot as never, makeStore([
      { id: '1', showId: 1, title: 'Show A' },
      { id: '2', showId: 2, title: 'Show B' },
    ]))

    const ctx: FakeCtx = { reply: mock(async () => {}) }
    await bot.trigger('subscriptions', ctx)

    const text = (ctx.reply.mock.calls[0] as [string])[0]
    expect(text).toContain('1. Show A (id: 1)')
    expect(text).toContain('2. Show B (id: 2)')
  })

  it('truncates a huge list under 4000 chars with «…и ещё N» (#298)', async () => {
    const subs: Subscription[] = Array.from({ length: 300 }, (_, i) => ({
      id: String(i),
      showId: i,
      title: `An Exceedingly Long Series Title For Truncation ${i}`,
    }))
    const bot = makeFakeBot()
    registerSubscriptionRoutes(bot as never, makeStore(subs))

    const ctx: FakeCtx = { reply: mock(async () => {}) }
    await bot.trigger('subscriptions', ctx)

    const text = (ctx.reply.mock.calls[0] as [string])[0]
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text).toMatch(/…и ещё \d+$/)
    expect(text).toContain('📋 Ваши подписки:')
    expect(text).toContain('1. An Exceedingly Long Series Title For Truncation 0')
  })
})
