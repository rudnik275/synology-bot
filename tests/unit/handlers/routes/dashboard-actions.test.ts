import { describe, it, expect, beforeEach, mock } from 'bun:test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CallbackHandler = (ctx: any) => Promise<void>

class FakeBot {
  handlers: Array<{ pattern: RegExp; fn: CallbackHandler }> = []

  callbackQuery(pattern: RegExp | string, fn: CallbackHandler) {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    this.handlers.push({ pattern: re, fn })
  }

  async dispatch(data: string, chatId: number, ctx: any) {
    for (const { pattern, fn } of this.handlers) {
      const m = data.match(pattern)
      if (m) {
        ctx.match = m
        await fn(ctx)
        return true
      }
    }
    return false
  }
}

type TaskResult = { ok: true } | { ok: false; reason: string }

class FakeSynologyClient {
  pauseTask: (id: string) => Promise<TaskResult> = mock(async (_id: string) => ({ ok: true as const }))
  resumeTask: (id: string) => Promise<TaskResult> = mock(async (_id: string) => ({ ok: true as const }))
  deleteTask: (id: string, del: boolean) => Promise<TaskResult> = mock(async (_id: string, _del: boolean) => ({ ok: true as const }))
}

class FakeLiveDashboard {
  refresh = mock(async (_chatId: number, _ctx: any) => {})
  isActive = mock((_chatId: number) => true)
  getMessageId = mock((_chatId: number) => 1)
  stop = mock((_chatId: number) => {})
  start = mock(async (_ctx: any) => {})
  extendLifetime = mock((_chatId: number) => {})
}

function makeCtx(chatId = 123, _callbackData = '') {
  const answerCallbackQuery = mock(async (..._args: unknown[]) => {})
  return {
    chat: { id: chatId },
    answerCallbackQuery,
    match: [] as unknown as RegExpMatchArray,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerDashboardActions', () => {
  let fakeBot: FakeBot
  let synology: FakeSynologyClient
  let dashboard: FakeLiveDashboard

  beforeEach(async () => {
    fakeBot = new FakeBot()
    synology = new FakeSynologyClient()
    dashboard = new FakeLiveDashboard()

    const { registerDashboardActions } = await import(
      '../../../../src/handlers/routes/dashboard-actions.ts'
    )
    registerDashboardActions(fakeBot as any, synology as any, dashboard as any)
  })

  // ─── pause action ─────────────────────────────────────────────────────────
  it('pause action calls pauseTask and refreshes dashboard', async () => {
    const ctx = makeCtx(100)
    await fakeBot.dispatch('dash_action:pause:task-abc', 100, ctx)

    expect(synology.pauseTask).toHaveBeenCalledWith('task-abc')
    expect(dashboard.refresh).toHaveBeenCalledWith(100, ctx)
    expect(ctx.answerCallbackQuery).toHaveBeenCalled()
  })

  it('pause action — synology failure shows alert and skips refresh', async () => {
    synology.pauseTask = mock(async () => ({ ok: false as const, reason: 'NAS error' }))
    const ctx = makeCtx(100)
    await fakeBot.dispatch('dash_action:pause:task-fail', 100, ctx)

    expect(dashboard.refresh).not.toHaveBeenCalled()
    // answerCallbackQuery is called with { text: '...', show_alert: true } object
    const allCalls = ctx.answerCallbackQuery.mock.calls as unknown as Array<[{ text?: string; show_alert?: boolean }]>
    const alertCall = allCalls.find((c) => c[0]?.show_alert === true)
    expect(alertCall).toBeDefined()
    expect(alertCall![0].text).toContain('NAS error')
  })

  // ─── resume action ────────────────────────────────────────────────────────
  it('resume action calls resumeTask and refreshes dashboard', async () => {
    const ctx = makeCtx(200)
    await fakeBot.dispatch('dash_action:resume:task-xyz', 200, ctx)

    expect(synology.resumeTask).toHaveBeenCalledWith('task-xyz')
    expect(dashboard.refresh).toHaveBeenCalledWith(200, ctx)
  })

  it('resume action — synology failure shows alert', async () => {
    synology.resumeTask = mock(async () => ({ ok: false as const, reason: 'Conn refused' }))
    const ctx = makeCtx(200)
    await fakeBot.dispatch('dash_action:resume:task-fail', 200, ctx)

    expect(dashboard.refresh).not.toHaveBeenCalled()
    const allCalls = ctx.answerCallbackQuery.mock.calls as unknown as Array<[{ text?: string; show_alert?: boolean }]>
    const alertCall = allCalls.find((c) => c[0]?.show_alert === true)
    expect(alertCall).toBeDefined()
  })

  // ─── delete confirmation flow ─────────────────────────────────────────────
  it('delete first tap → confirmation prompt (no actual delete)', async () => {
    const ctx = makeCtx(300)
    await fakeBot.dispatch('dash_action:delete:task-del', 300, ctx)

    expect(synology.deleteTask).not.toHaveBeenCalled()
    expect(dashboard.refresh).not.toHaveBeenCalled()
    // Should have answered with a confirmation prompt
    const allCalls = ctx.answerCallbackQuery.mock.calls as unknown as Array<[{ text?: string; show_alert?: boolean }]>
    const confirmCall = allCalls.find((c) => {
      const text = c[0]?.text ?? ''
      return text.includes('подтвер') || text.includes('ещё раз')
    })
    expect(confirmCall).toBeDefined()
  })

  it('delete second tap → actually deletes (delete_files=false)', async () => {
    const ctx = makeCtx(300)
    // First tap
    await fakeBot.dispatch('dash_action:delete:task-del2', 300, ctx)
    // Second tap
    await fakeBot.dispatch('dash_action:delete:task-del2', 300, ctx)

    expect(synology.deleteTask).toHaveBeenCalledWith('task-del2', false)
    expect(dashboard.refresh).toHaveBeenCalledWith(300, ctx)
  })

  it('delete — different tasks do not share confirmation state', async () => {
    const ctx1 = makeCtx(300)
    const ctx2 = makeCtx(300)
    // First tap for task-a
    await fakeBot.dispatch('dash_action:delete:task-a', 300, ctx1)
    // First tap for task-b — should NOT delete task-a
    await fakeBot.dispatch('dash_action:delete:task-b', 300, ctx2)

    expect(synology.deleteTask).not.toHaveBeenCalled()
  })

  // ─── extendLifetime called on successful actions ───────────────────────────
  it('pause action calls extendLifetime after successful pauseTask', async () => {
    const ctx = makeCtx(100)
    await fakeBot.dispatch('dash_action:pause:task-abc', 100, ctx)

    expect(dashboard.extendLifetime).toHaveBeenCalledWith(100)
  })

  it('resume action calls extendLifetime after successful resumeTask', async () => {
    const ctx = makeCtx(200)
    await fakeBot.dispatch('dash_action:resume:task-xyz', 200, ctx)

    expect(dashboard.extendLifetime).toHaveBeenCalledWith(200)
  })

  it('delete second tap calls extendLifetime after successful delete', async () => {
    const ctx = makeCtx(300)
    // First tap
    await fakeBot.dispatch('dash_action:delete:task-del3', 300, ctx)
    // Second tap
    await fakeBot.dispatch('dash_action:delete:task-del3', 300, ctx)

    expect(dashboard.extendLifetime).toHaveBeenCalledWith(300)
  })

  it('pause failure does NOT call extendLifetime', async () => {
    synology.pauseTask = mock(async () => ({ ok: false as const, reason: 'NAS error' }))
    const ctx = makeCtx(100)
    await fakeBot.dispatch('dash_action:pause:task-fail', 100, ctx)

    expect(dashboard.extendLifetime).not.toHaveBeenCalled()
  })

  // ─── dash_refresh handler ──────────────────────────────────────────────────
  it('dash_refresh callback calls dashboard.start()', async () => {
    const ctx = makeCtx(400)
    const dispatched = await fakeBot.dispatch('dash_refresh', 400, ctx)

    expect(dispatched).toBe(true)
    expect(dashboard.start).toHaveBeenCalledWith(ctx)
  })
})
