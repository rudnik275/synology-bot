import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { registerTaskActionsRoute, buildTaskActionKeyboard, type TaskActionsDeps } from '../../../../src/handlers/routes/task-actions.ts'
import type { SynologyClient } from '../../../../src/infra/synology/client.ts'

// ---- Minimal grammy stubs ----

type CallbackHandler = (ctx: FakeCallbackCtx) => Promise<void>

interface FakeCallbackCtx {
  match: RegExpMatchArray
  callbackQuery: { message?: { text?: string } }
  answerCallbackQuery: ReturnType<typeof mock>
  editMessageText: ReturnType<typeof mock>
  reply: ReturnType<typeof mock>
}

function makeCallbackCtx(
  taskId: string,
  // null models Telegram's InaccessibleMessage (>48h old) — message.text undefined
  messageText: string | null = 'Alert message'
): FakeCallbackCtx {
  return {
    match: Object.assign(['', taskId], { index: 0, input: '' }) as RegExpMatchArray,
    callbackQuery: { message: messageText === null ? {} : { text: messageText } },
    answerCallbackQuery: mock(async () => {}),
    editMessageText: mock(async () => {}),
    reply: mock(async () => {}),
  }
}

function makeFakeBot() {
  const cbHandlers: Map<RegExp, CallbackHandler> = new Map()
  return {
    callbackQuery(pattern: RegExp, handler: CallbackHandler) {
      cbHandlers.set(pattern, handler)
    },
    async trigger(data: string, ctx: FakeCallbackCtx) {
      for (const [pattern, handler] of cbHandlers) {
        const m = data.match(pattern)
        if (m) {
          ctx.match = m as RegExpMatchArray
          await handler(ctx)
          return
        }
      }
      throw new Error(`No handler matched: ${data}`)
    },
  }
}

function makeSynoStub(overrides: Partial<SynologyClient> = {}): SynologyClient {
  return {
    pauseTask: mock(async () => ({ ok: true as const })),
    resumeTask: mock(async () => ({ ok: true as const })),
    deleteTask: mock(async () => ({ ok: true as const })),
    ...overrides,
  } as unknown as SynologyClient
}

function makeDeps(synology: SynologyClient): TaskActionsDeps & { clearNotifFired: ReturnType<typeof mock> } {
  return { synology, clearNotifFired: mock(() => {}) }
}

// ---- Tests ----

describe('task-actions handler', () => {
  let bot: ReturnType<typeof makeFakeBot>
  let synology: SynologyClient
  let deps: ReturnType<typeof makeDeps>

  beforeEach(() => {
    bot = makeFakeBot()
    synology = makeSynoStub()
    deps = makeDeps(synology)
    registerTaskActionsRoute(bot as never, deps)
  })

  describe('resume action', () => {
    it('calls resumeTask with the taskId', async () => {
      const ctx = makeCallbackCtx('task-123', 'Alert: stuck')
      await bot.trigger('task_action:resume:task-123', ctx)

      expect((synology.resumeTask as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe('task-123')
    })

    it('edits message with ✅ Возобновлено on success', async () => {
      const ctx = makeCallbackCtx('task-123', 'Alert: stuck')
      await bot.trigger('task_action:resume:task-123', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('✅ Возобновлено')
      expect(editCall[0]).toContain('Alert: stuck')
    })

    it('edits message with ❌ Не удалось on failure', async () => {
      const failSyno = makeSynoStub({
        resumeTask: mock(async () => ({ ok: false as const, reason: 'NAS offline' })),
      })
      const failBot = makeFakeBot()
      registerTaskActionsRoute(failBot as never, makeDeps(failSyno))

      const ctx = makeCallbackCtx('task-123', 'Alert: stuck')
      await failBot.trigger('task_action:resume:task-123', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('❌ Не удалось')
      expect(editCall[0]).toContain('NAS offline')
    })

    it('clears failed + stuck dedups on successful resume (#301)', async () => {
      const ctx = makeCallbackCtx('task-123', 'Alert: stuck')
      await bot.trigger('task_action:resume:task-123', ctx)

      const calls = deps.clearNotifFired.mock.calls as Array<[string, string]>
      expect(calls).toContainEqual(['task-123', 'failed'])
      expect(calls).toContainEqual(['task-123', 'stuck'])
    })

    it('does NOT clear dedups when resume fails (#301)', async () => {
      const failSyno = makeSynoStub({
        resumeTask: mock(async () => ({ ok: false as const, reason: 'NAS offline' })),
      })
      const failBot = makeFakeBot()
      const failDeps = makeDeps(failSyno)
      registerTaskActionsRoute(failBot as never, failDeps)

      const ctx = makeCallbackCtx('task-123', 'Alert: stuck')
      await failBot.trigger('task_action:resume:task-123', ctx)

      expect(failDeps.clearNotifFired.mock.calls.length).toBe(0)
    })

    it('replies with a new message when the alert is inaccessible (>48h) (#297)', async () => {
      const ctx = makeCallbackCtx('task-123', null)
      await bot.trigger('task_action:resume:task-123', ctx)

      expect((ctx.editMessageText as ReturnType<typeof mock>).mock.calls.length).toBe(0)
      const replyCall = (ctx.reply as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(replyCall[0]).toContain('✅ Возобновлено')
    })
  })

  describe('pause action', () => {
    it('calls pauseTask with the taskId', async () => {
      const ctx = makeCallbackCtx('task-456', 'Alert: stuck')
      await bot.trigger('task_action:pause:task-456', ctx)

      expect((synology.pauseTask as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe('task-456')
    })

    it('edits message with ✅ Приостановлено on success', async () => {
      const ctx = makeCallbackCtx('task-456', 'Alert text')
      await bot.trigger('task_action:pause:task-456', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('✅ Приостановлено')
    })

    it('edits message with ❌ Не удалось on failure', async () => {
      const failSyno = makeSynoStub({
        pauseTask: mock(async () => ({ ok: false as const, reason: 'Timeout' })),
      })
      const failBot = makeFakeBot()
      registerTaskActionsRoute(failBot as never, makeDeps(failSyno))

      const ctx = makeCallbackCtx('task-456', 'Alert text')
      await failBot.trigger('task_action:pause:task-456', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('❌ Не удалось')
      expect(editCall[0]).toContain('Timeout')
    })

    it('replies with a new message when the alert is inaccessible (>48h) (#297)', async () => {
      const ctx = makeCallbackCtx('task-456', null)
      await bot.trigger('task_action:pause:task-456', ctx)

      expect((ctx.editMessageText as ReturnType<typeof mock>).mock.calls.length).toBe(0)
      const replyCall = (ctx.reply as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(replyCall[0]).toContain('✅ Приостановлено')
    })
  })

  describe('delete confirmation flow', () => {
    it('first delete tap → shows confirmation prompt', async () => {
      const ctx = makeCallbackCtx('task-789', 'Alert: failed')
      await bot.trigger('task_action:delete:task-789', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('⚠️ Точно удалить?')
      expect(editCall[0]).toContain('Alert: failed')
    })

    it('delete confirm → calls deleteTask', async () => {
      const ctx = makeCallbackCtx(
        'task-789',
        'Alert: failed\n\n⚠️ Точно удалить? [Да] [Отмена]'
      )
      await bot.trigger('task_action:delete_confirm:task-789', ctx)

      expect((synology.deleteTask as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe('task-789')
    })

    it('delete confirm success → edits message with ✅ Удалено', async () => {
      const originalText = 'Alert: failed'
      const ctx = makeCallbackCtx(
        'task-789',
        `${originalText}\n\n⚠️ Точно удалить? [Да] [Отмена]`
      )
      await bot.trigger('task_action:delete_confirm:task-789', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('✅ Удалено')
      expect(editCall[0]).toContain(originalText)
      expect(editCall[0]).not.toContain('⚠️ Точно удалить?')
    })

    it('delete confirm failure → edits message with ❌ Не удалось', async () => {
      const failSyno = makeSynoStub({
        deleteTask: mock(async () => ({ ok: false as const, reason: 'Permission denied' })),
      })
      const failBot = makeFakeBot()
      registerTaskActionsRoute(failBot as never, makeDeps(failSyno))

      const ctx = makeCallbackCtx(
        'task-789',
        'Alert: failed\n\n⚠️ Точно удалить? [Да] [Отмена]'
      )
      await failBot.trigger('task_action:delete_confirm:task-789', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toContain('❌ Не удалось')
      expect(editCall[0]).toContain('Permission denied')
    })

    it('delete cancel → reverts message without confirmation prompt', async () => {
      const originalText = 'Alert: failed'
      const ctx = makeCallbackCtx(
        'task-789',
        `${originalText}\n\n⚠️ Точно удалить? [Да] [Отмена]`
      )
      await bot.trigger('task_action:delete_cancel:task-789', ctx)

      const editCall = (ctx.editMessageText as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(editCall[0]).toBe(originalText)
      expect(editCall[0]).not.toContain('⚠️ Точно удалить?')
    })

    it('delete on inaccessible message → replies with confirmation prompt (#297)', async () => {
      const ctx = makeCallbackCtx('task-789', null)
      await bot.trigger('task_action:delete:task-789', ctx)

      expect((ctx.editMessageText as ReturnType<typeof mock>).mock.calls.length).toBe(0)
      const replyCall = (ctx.reply as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(replyCall[0]).toContain('⚠️ Точно удалить?')
    })

    it('delete confirm on inaccessible message → replies with result (#297)', async () => {
      const ctx = makeCallbackCtx('task-789', null)
      await bot.trigger('task_action:delete_confirm:task-789', ctx)

      expect((synology.deleteTask as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe('task-789')
      expect((ctx.editMessageText as ReturnType<typeof mock>).mock.calls.length).toBe(0)
      const replyCall = (ctx.reply as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(replyCall[0]).toContain('✅ Удалено')
    })

    it('delete cancel on inaccessible message → replies Отменено without editing (#297)', async () => {
      const ctx = makeCallbackCtx('task-789', null)
      await bot.trigger('task_action:delete_cancel:task-789', ctx)

      expect((ctx.editMessageText as ReturnType<typeof mock>).mock.calls.length).toBe(0)
      const replyCall = (ctx.reply as ReturnType<typeof mock>).mock.calls[0] as [string]
      expect(replyCall[0]).toContain('Отменено')
    })
  })

  describe('buildTaskActionKeyboard', () => {
    it('returns an InlineKeyboard with Resume, Pause, Delete buttons', () => {
      const kb = buildTaskActionKeyboard('task-1')
      // InlineKeyboard rows: first row has 3 buttons
      const buttons = kb.inline_keyboard.flat() as Array<{ callback_data?: string }>
      expect(buttons.some((b) => b.callback_data?.includes('resume:task-1'))).toBe(true)
      expect(buttons.some((b) => b.callback_data?.includes('pause:task-1'))).toBe(true)
      expect(buttons.some((b) => b.callback_data?.includes('delete:task-1'))).toBe(true)
    })
  })
})
