// #120 — the bot accepts a magnet / http(s) URL pasted as text, stashes the URI
// under a short-lived token, and replies with a Mini App deep-link button.
// Ordinary chat text is ignored. Mirrors the torrent-intake.test.ts fake-bot
// style (a minimal grammy stub).
import { describe, it, expect, mock } from 'bun:test'
import {
  registerUriIntakeRoute,
  isAddIntakeUri,
} from '../../../../src/handlers/routes/torrent-intake.ts'
import type { PersistentStore } from '../../../../src/infra/persistence/store.ts'

// ---- Minimal grammy stub ----

type FilterHandler = (ctx: FakeTextCtx) => Promise<void>

interface FakeTextCtx {
  message: { text: string }
  reply: ReturnType<typeof mock>
}

function makeFakeBot() {
  const handlers: Map<string, FilterHandler> = new Map()
  return {
    on(filter: string, handler: FilterHandler) {
      handlers.set(filter, handler)
    },
    async emit(filter: string, ctx: FakeTextCtx) {
      const h = handlers.get(filter)
      if (!h) throw new Error(`No handler for ${filter}`)
      await h(ctx)
    },
  }
}

function makeCtx(text: string): FakeTextCtx {
  return { message: { text }, reply: mock(async () => ({})) }
}

function makeStore(): Pick<PersistentStore, 'stashUri'> & { stashUri: ReturnType<typeof mock> } {
  return { stashUri: mock(() => {}) }
}

function deps(over: Record<string, unknown> = {}) {
  return {
    store: makeStore(),
    miniappUrl: 'https://app.example',
    makeToken: () => 'TOKEN123',
    ...over,
  }
}

describe('isAddIntakeUri matcher (#120)', () => {
  it('matches a magnet link', () => {
    expect(isAddIntakeUri('magnet:?xt=urn:btih:abc123&dn=Movie')).toBe(true)
  })

  it('matches an http(s) URL (incl. direct .torrent URLs)', () => {
    expect(isAddIntakeUri('https://tracker.example/file.torrent')).toBe(true)
    expect(isAddIntakeUri('http://tracker.example/file.torrent')).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isAddIntakeUri('  magnet:?xt=urn:btih:abc  ')).toBe(true)
  })

  it('ignores ordinary chat text', () => {
    expect(isAddIntakeUri('hello there')).toBe(false)
    expect(isAddIntakeUri('check this magnet please')).toBe(false)
    expect(isAddIntakeUri('/ping_nas')).toBe(false)
    expect(isAddIntakeUri('ftp://nope.example/x')).toBe(false)
    expect(isAddIntakeUri('')).toBe(false)
    // A URL embedded in a sentence is not add-intent.
    expect(isAddIntakeUri('see https://example.com for details')).toBe(false)
  })
})

describe('uri-intake handler (#120)', () => {
  it('stashes a magnet URI and replies with an Открыть deep-link button', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    const magnet = 'magnet:?xt=urn:btih:abc123'
    const ctx = makeCtx(magnet)
    await bot.emit('message:text', ctx)

    const stashCall = d.store.stashUri.mock.calls[0]
    expect(stashCall[0]).toBe('TOKEN123')
    expect(stashCall[1]).toBe(magnet)

    const replyOpts = ctx.reply.mock.calls[0][1] as {
      reply_markup?: { inline_keyboard: unknown[][] }
    }
    const btn = replyOpts.reply_markup!.inline_keyboard.flat()[0] as { web_app?: { url: string } }
    expect(btn.web_app?.url).toContain('tgWebAppStartParam=tor-TOKEN123')
  })

  it('stashes an http(s) URL (trimmed)', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    await bot.emit('message:text', makeCtx('  https://tracker.example/x.torrent  '))

    expect(d.store.stashUri).toHaveBeenCalledTimes(1)
    expect(d.store.stashUri.mock.calls[0][1]).toBe('https://tracker.example/x.torrent')
  })

  it('ignores ordinary text — no stash, no reply', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    const ctx = makeCtx('just chatting')
    await bot.emit('message:text', ctx)

    expect(d.store.stashUri).not.toHaveBeenCalled()
    // Stays silent so the DM isn't noisy.
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('extracts and stashes a magnet embedded in surrounding text (#299)', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    const magnet = 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12&dn=Movie'
    const ctx = makeCtx(`Смотри что нашёл:\n${magnet}\nкачни плз`)
    await bot.emit('message:text', ctx)

    expect(d.store.stashUri).toHaveBeenCalledTimes(1)
    expect(d.store.stashUri.mock.calls[0][1]).toBe(magnet)

    const replyOpts = ctx.reply.mock.calls[0][1] as {
      reply_markup?: { inline_keyboard: unknown[][] }
    }
    const btn = replyOpts.reply_markup!.inline_keyboard.flat()[0] as { web_app?: { url: string } }
    expect(btn.web_app?.url).toContain('tgWebAppStartParam=tor-TOKEN123')
  })

  it('still ignores a plain http URL embedded in a sentence (no magnet)', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    const ctx = makeCtx('see https://example.com for details')
    await bot.emit('message:text', ctx)

    expect(d.store.stashUri).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('a standalone http(s) URL still triggers intake (behavior unchanged)', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerUriIntakeRoute(bot as never, d as never)

    await bot.emit('message:text', makeCtx('https://tracker.example/file.torrent'))

    expect(d.store.stashUri).toHaveBeenCalledTimes(1)
    expect(d.store.stashUri.mock.calls[0][1]).toBe('https://tracker.example/file.torrent')
  })

  it('does not stash when the Mini App is not configured (empty miniappUrl)', async () => {
    const bot = makeFakeBot()
    const d = deps({ miniappUrl: '' })
    registerUriIntakeRoute(bot as never, d as never)

    const ctx = makeCtx('magnet:?xt=urn:btih:abc')
    await bot.emit('message:text', ctx)

    expect(d.store.stashUri).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledTimes(1)
  })
})
