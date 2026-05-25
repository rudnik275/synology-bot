import { describe, it, expect, mock } from 'bun:test'
import { createOwnerOnlyMiddleware } from '../../../../src/handlers/middleware/owner-only.ts'
import type { PersistentStore } from '../../../../src/infra/persistence/store.ts'

function makeStore(): { setKv: ReturnType<typeof mock>; getKv: ReturnType<typeof mock> } {
  return {
    setKv: mock(() => {}),
    getKv: mock(() => undefined),
  }
}

function makeCtx(overrides: {
  chatType?: string
  chatId?: number
} = {}) {
  const { chatType = 'private', chatId = 99999 } = overrides
  return {
    chat: { type: chatType, id: chatId },
  }
}

describe('ownerOnly middleware', () => {
  const OWNER_CHAT_ID = 12345

  it('calls next() when chat.id matches OWNER_CHAT_ID', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER_CHAT_ID, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatId: OWNER_CHAT_ID })

    await middleware(ctx as never, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('writes owner_chat_id to PersistentStore when Owner calls', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER_CHAT_ID, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatId: OWNER_CHAT_ID })

    await middleware(ctx as never, next)

    expect(store.setKv).toHaveBeenCalledWith('owner_chat_id', String(OWNER_CHAT_ID))
  })

  it('returns silently without calling next() for non-Owner chat id', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER_CHAT_ID, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatId: 77777 })

    await middleware(ctx as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(store.setKv).not.toHaveBeenCalled()
  })

  it('does not reply to non-Owner (no ctx.reply method needed)', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER_CHAT_ID, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatId: 77777 })

    await expect(middleware(ctx as never, next)).resolves.toBeUndefined()
  })

  it('returns silently when chat type is not private (even if id matches)', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER_CHAT_ID, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatType: 'group', chatId: OWNER_CHAT_ID })

    await middleware(ctx as never, next)

    expect(next).not.toHaveBeenCalled()
  })
})
