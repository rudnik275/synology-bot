import { describe, it, expect, mock } from 'bun:test'
import { createOwnerOnlyMiddleware } from '../../../../src/handlers/middleware/owner-only.ts'
import type { PersistentStore } from '../../../../src/infra/persistence/store.ts'

// Minimal fake PersistentStore for middleware tests
function makeStore(): { setKv: ReturnType<typeof mock>; getKv: ReturnType<typeof mock> } {
  return {
    setKv: mock(() => {}),
    getKv: mock(() => undefined),
  }
}

// Build a minimal grammy-like context
function makeCtx(overrides: {
  chatType?: string
  username?: string
  chatId?: number
} = {}) {
  const { chatType = 'private', username, chatId = 99999 } = overrides
  return {
    chat: chatType === 'private'
      ? { type: 'private', username, id: chatId }
      : { type: chatType, id: chatId },
  }
}

describe('ownerOnly middleware', () => {
  const OWNER = 'owner_user'

  // --- Cycle 7: Owner passes through and writes owner_chat_id ---
  it('calls next() when username matches OWNER_USERNAME', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ username: OWNER, chatId: 12345 })

    await middleware(ctx as never, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('writes owner_chat_id to PersistentStore when Owner calls', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ username: OWNER, chatId: 12345 })

    await middleware(ctx as never, next)

    expect(store.setKv).toHaveBeenCalledWith('owner_chat_id', '12345')
  })

  // --- Cycle 8: non-Owner is silently ignored ---
  it('returns silently without calling next() for non-Owner username', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ username: 'intruder', chatId: 77777 })

    await middleware(ctx as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(store.setKv).not.toHaveBeenCalled()
  })

  it('does not reply to non-Owner (no ctx.reply method needed)', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ username: 'intruder' })

    // If middleware tries to call ctx.reply, it will throw — context has no reply method
    await expect(middleware(ctx as never, next)).resolves.toBeUndefined()
  })

  // --- Cycle 9: missing username returns silently ---
  it('returns silently when ctx.chat.username is undefined', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ username: undefined })

    await middleware(ctx as never, next)

    expect(next).not.toHaveBeenCalled()
  })

  it('returns silently when chat type is not private', async () => {
    const store = makeStore()
    const middleware = createOwnerOnlyMiddleware(OWNER, store as unknown as PersistentStore)
    const next = mock(async () => {})
    const ctx = makeCtx({ chatType: 'group', username: OWNER })

    await middleware(ctx as never, next)

    expect(next).not.toHaveBeenCalled()
  })
})
