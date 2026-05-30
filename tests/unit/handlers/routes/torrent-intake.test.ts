import { describe, it, expect, mock } from 'bun:test'
import { registerTorrentIntakeRoute } from '../../../../src/handlers/routes/torrent-intake.ts'
import type { PersistentStore } from '../../../../src/infra/persistence/store.ts'

// ---- Minimal grammy stubs (mirrors task-actions.test.ts style) ----

type FilterHandler = (ctx: FakeMsgCtx) => Promise<void>

interface FakeDocument {
  file_id: string
  file_name?: string
  mime_type?: string
}
interface FakeMsgCtx {
  message: { document?: FakeDocument }
  getFile: ReturnType<typeof mock>
  reply: ReturnType<typeof mock>
}

function makeFakeBot() {
  const handlers: Map<string, FilterHandler> = new Map()
  return {
    on(filter: string, handler: FilterHandler) {
      handlers.set(filter, handler)
    },
    async emit(filter: string, ctx: FakeMsgCtx) {
      const h = handlers.get(filter)
      if (!h) throw new Error(`No handler for ${filter}`)
      await h(ctx)
    },
  }
}

function makeCtx(doc: FakeDocument | undefined, filePath = 'documents/file_1.torrent'): FakeMsgCtx {
  return {
    message: { document: doc },
    getFile: mock(async () => ({ file_id: doc?.file_id ?? 'f', file_path: filePath })),
    reply: mock(async () => ({})),
  }
}

function makeStore(): Pick<PersistentStore, 'stashTorrent'> & { stashTorrent: ReturnType<typeof mock> } {
  return { stashTorrent: mock(() => {}) }
}

const STASHED = new Uint8Array([1, 2, 3, 4])

function deps(over: Record<string, unknown> = {}) {
  return {
    store: makeStore(),
    botToken: 'BOT:TOKEN',
    miniappUrl: 'https://app.example',
    fetchFileBytes: mock(async () => STASHED),
    makeToken: () => 'TOKEN123',
    ...over,
  }
}

describe('torrent-intake handler', () => {
  it('stashes a .torrent (by extension) and replies with an Открыть deep-link button', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerTorrentIntakeRoute(bot as never, d as never)

    const ctx = makeCtx({ file_id: 'f1', file_name: 'Big.Buck.Bunny.torrent' })
    await bot.emit('message:document', ctx)

    // Stashed under the generated token with the file bytes + name.
    const stashCall = d.store.stashTorrent.mock.calls[0]
    expect(stashCall[0]).toBe('TOKEN123')
    expect(stashCall[1]).toBe('Big.Buck.Bunny.torrent')
    expect(Array.from(stashCall[2] as Uint8Array)).toEqual(Array.from(STASHED))

    // Replied with a web_app button pointing at the stash token.
    const replyOpts = ctx.reply.mock.calls[0][1] as { reply_markup?: { inline_keyboard: unknown[][] } }
    const btn = replyOpts.reply_markup!.inline_keyboard.flat()[0] as { web_app?: { url: string } }
    expect(btn.web_app?.url).toContain('tgWebAppStartParam=tor-TOKEN123')
  })

  it('accepts a torrent by mime type even without a .torrent extension', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerTorrentIntakeRoute(bot as never, d as never)

    const ctx = makeCtx({ file_id: 'f2', file_name: 'download', mime_type: 'application/x-bittorrent' })
    await bot.emit('message:document', ctx)

    expect(d.store.stashTorrent).toHaveBeenCalledTimes(1)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-torrent document without stashing', async () => {
    const bot = makeFakeBot()
    const d = deps()
    registerTorrentIntakeRoute(bot as never, d as never)

    const ctx = makeCtx({ file_id: 'f3', file_name: 'notes.pdf', mime_type: 'application/pdf' })
    await bot.emit('message:document', ctx)

    expect(d.store.stashTorrent).not.toHaveBeenCalled()
    expect(d.fetchFileBytes).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledTimes(1) // a "not a .torrent" reply
  })

  it('does not stash when the download fails, and replies with an error', async () => {
    const bot = makeFakeBot()
    const d = deps({ fetchFileBytes: mock(async () => { throw new Error('boom') }) })
    registerTorrentIntakeRoute(bot as never, d as never)

    const ctx = makeCtx({ file_id: 'f4', file_name: 'x.torrent' })
    await bot.emit('message:document', ctx)

    expect(d.store.stashTorrent).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledTimes(1)
  })

  it('does not stash when the Mini App is not configured (empty miniappUrl)', async () => {
    const bot = makeFakeBot()
    const d = deps({ miniappUrl: '' })
    registerTorrentIntakeRoute(bot as never, d as never)

    const ctx = makeCtx({ file_id: 'f5', file_name: 'x.torrent' })
    await bot.emit('message:document', ctx)

    expect(d.store.stashTorrent).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledTimes(1)
  })
})
