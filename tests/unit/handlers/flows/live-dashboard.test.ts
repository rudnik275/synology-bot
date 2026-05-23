import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { LiveDashboard } from '../../../../src/handlers/flows/live-dashboard.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

// ─── Fake SynologyClient ──────────────────────────────────────────────────────

class FakeSynologyClient {
  tasks: Task[] = []

  async listTasks() {
    return { ok: true as const, data: this.tasks }
  }

  pauseTask = mock(async (_id: string) => ({ ok: true as const }))
  resumeTask = mock(async (_id: string) => ({ ok: true as const }))
  deleteTask = mock(async (_id: string, _del: boolean) => ({ ok: true as const }))
}

// ─── Fake Context ─────────────────────────────────────────────────────────────

function makeFakeCtx(chatId = 123, messageId = 42) {
  const editMessageText = mock(async () => ({}))
  const sendMessage = mock(async () => ({ message_id: messageId }))

  const ctx = {
    chat: { id: chatId },
    api: {
      sendMessage,
      editMessageText,
    },
  } as unknown as import('grammy').Context

  return { ctx, sendMessage, editMessageText }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiveDashboard', () => {
  let synology: FakeSynologyClient
  let dashboard: LiveDashboard

  beforeEach(() => {
    synology = new FakeSynologyClient()
    // Use a large refreshMs to avoid automatic ticks during tests
    dashboard = new LiveDashboard(synology as any, 999_999)
  })

  afterEach(() => {
    // Clean up any active timers
    ;(dashboard as any).active.forEach((_: any, chatId: number) => {
      dashboard.stop(chatId)
    })
  })

  // ─── start() creates entry ─────────────────────────────────────────────────
  it('start creates active entry with sent message id', async () => {
    const { ctx, sendMessage } = makeFakeCtx(100, 55)
    synology.tasks = []

    await dashboard.start(ctx)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(dashboard.isActive(100)).toBe(true)
    expect(dashboard.getMessageId(100)).toBe(55)
  })

  // ─── second start stops previous ──────────────────────────────────────────
  it('second start stops previous interval and replaces entry', async () => {
    const { ctx: ctx1, sendMessage: send1 } = makeFakeCtx(200, 10)
    const { ctx: ctx2, sendMessage: send2 } = makeFakeCtx(200, 20)
    synology.tasks = []

    await dashboard.start(ctx1)
    expect(dashboard.getMessageId(200)).toBe(10)

    await dashboard.start(ctx2)
    expect(dashboard.getMessageId(200)).toBe(20)

    // Both sends were called
    expect(send1).toHaveBeenCalledTimes(1)
    expect(send2).toHaveBeenCalledTimes(1)
  })

  // ─── stop clears interval ─────────────────────────────────────────────────
  it('stop removes active entry', async () => {
    const { ctx } = makeFakeCtx(300, 77)
    synology.tasks = []

    await dashboard.start(ctx)
    expect(dashboard.isActive(300)).toBe(true)

    dashboard.stop(300)
    expect(dashboard.isActive(300)).toBe(false)
    expect(dashboard.getMessageId(300)).toBeUndefined()
  })

  it('stop is a no-op when no active dashboard for that chat', () => {
    // Should not throw
    expect(() => dashboard.stop(999)).not.toThrow()
  })

  // ─── refresh calls editMessageText ────────────────────────────────────────
  it('refresh calls editMessageText with updated content', async () => {
    const { ctx, editMessageText } = makeFakeCtx(400, 88)
    synology.tasks = []

    await dashboard.start(ctx)
    await dashboard.refresh(400, ctx)

    expect(editMessageText).toHaveBeenCalledTimes(1)
    const call = (editMessageText.mock.calls[0] as unknown[])
    expect(call[0]).toBe(400)
    expect(call[1]).toBe(88)
  })

  it('refresh is a no-op when dashboard is not active', async () => {
    const { ctx, editMessageText } = makeFakeCtx(500, 99)
    synology.tasks = []

    // No start called
    await dashboard.refresh(500, ctx)

    expect(editMessageText).not.toHaveBeenCalled()
  })

  // ─── refresh ignores "message is not modified" error ──────────────────────
  it('refresh ignores "message is not modified" telegram error', async () => {
    const messageId = 111
    const editMessageText = mock(async () => {
      throw new Error('Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')
    })
    const sendMessage = mock(async () => ({ message_id: messageId }))
    const ctx = {
      chat: { id: 600 },
      api: { sendMessage, editMessageText },
    } as unknown as import('grammy').Context

    synology.tasks = []
    await dashboard.start(ctx)
    // Should not throw
    await expect(dashboard.refresh(600, ctx)).resolves.toBeUndefined()
  })

  // ─── sends correct text for empty task list ───────────────────────────────
  it('start with empty tasks sends нет активных задач', async () => {
    const { ctx, sendMessage } = makeFakeCtx(700, 1)
    synology.tasks = []

    await dashboard.start(ctx)

    const call = sendMessage.mock.calls[0] as unknown as [number, string, ...unknown[]]
    expect(call[1]).toContain('Нет активных задач')
  })

  // ─── sends tasks text when tasks exist ───────────────────────────────────
  it('start with tasks sends formatted task list', async () => {
    const { ctx, sendMessage } = makeFakeCtx(800, 2)
    synology.tasks = [
      {
        id: 't1',
        title: 'Test.mkv',
        status: 'downloading',
        size: 1_000_000,
        additional: { transfer: { size_downloaded: 500_000, speed_download: 1024 } },
      },
    ]

    await dashboard.start(ctx)

    const call = sendMessage.mock.calls[0] as unknown as [number, string, ...unknown[]]
    expect(call[1]).toContain('Активные задачи (1)')
    expect(call[1]).toContain('Test.mkv')
  })
})
