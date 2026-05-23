import { describe, it, expect, mock } from 'bun:test'
import { setReaction, clearReaction } from '../../../../src/infra/telegram/reactions.ts'

function makeCtx(overrides?: Partial<{
  react: (...args: unknown[]) => Promise<unknown>
  reply: (...args: unknown[]) => Promise<unknown>
}>) {
  return {
    react: mock(() => Promise.resolve()),
    reply: mock(() => Promise.resolve()),
    ...overrides,
  }
}

describe('setReaction', () => {
  it('calls ctx.react for pending reaction', async () => {
    const ctx = makeCtx()
    await setReaction(ctx as never, 'pending')
    expect(ctx.react).toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('calls ctx.react for success reaction', async () => {
    const ctx = makeCtx()
    await setReaction(ctx as never, 'success')
    expect(ctx.react).toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('calls ctx.react for error reaction', async () => {
    const ctx = makeCtx()
    await setReaction(ctx as never, 'error')
    expect(ctx.react).toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('falls back to reply when ctx.react throws', async () => {
    const ctx = makeCtx({
      react: mock(() => Promise.reject(new Error('reactions disabled'))),
    })
    // Should not throw
    await setReaction(ctx as never, 'success')
    expect(ctx.reply).toHaveBeenCalled()
  })

  it('does not call reply when react succeeds', async () => {
    const ctx = makeCtx()
    await setReaction(ctx as never, 'success')
    expect(ctx.reply).not.toHaveBeenCalled()
  })
})

describe('clearReaction', () => {
  it('calls ctx.react with empty array', async () => {
    const ctx = makeCtx()
    await clearReaction(ctx as never)
    expect(ctx.react).toHaveBeenCalledWith([])
  })

  it('silently ignores errors from ctx.react', async () => {
    const ctx = makeCtx({
      react: mock(() => Promise.reject(new Error('not allowed'))),
    })
    await expect(clearReaction(ctx as never)).resolves.toBeUndefined()
  })
})
