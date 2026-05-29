import { describe, it, expect } from 'bun:test'
import { Notifier } from '../../../../src/domain/notifier/notifier.ts'
import { OwnerNotifier, type LowLevelSend } from '../../../../src/infra/notify/owner-notifier.ts'
import { openMiniAppButton } from '../../../../src/infra/notify/miniapp-link.ts'
import type { Task } from '../../../../src/infra/synology/types.ts'

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: `Task ${overrides.id}`,
    status: 'finished',
    size: 1000,
    ...overrides,
  }
}

interface TestHarness {
  notifier: Notifier
  sent: Array<Parameters<LowLevelSend>[0]>
  kv: Map<string, string>
}

function makeHarness(ownerChatId?: string, miniappUrl = ''): TestHarness {
  const kv = new Map<string, string>()
  if (ownerChatId) kv.set('owner_chat_id', ownerChatId)
  const sent: Array<Parameters<LowLevelSend>[0]> = []
  const owner = new OwnerNotifier(
    { getKv: (key) => kv.get(key) },
    async (p) => { sent.push(p) }
  )
  const notifier = new Notifier(owner, () => openMiniAppButton(miniappUrl, 'downloads'))
  return { notifier, sent, kv }
}

describe('Notifier', () => {
  it('sends finished push to owner with ✅ prefix', async () => {
    const h = makeHarness('12345')
    await h.notifier.notify(makeTask({ id: 'task-1', title: 'My Movie' }))

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].chatId).toBe(12345)
    expect(h.sent[0].text).toContain('✅ Скачано: My Movie')
  })

  it('includes destination when present', async () => {
    const h = makeHarness('12345')
    await h.notifier.notify(makeTask({
      id: 'task-1',
      title: 'My Movie',
      additional: { detail: { destination: '/volume1/video' } },
    }))

    expect(h.sent[0].text).toContain('Папка: /volume1/video')
  })

  it('omits Папка line when destination is missing', async () => {
    const h = makeHarness('12345')
    await h.notifier.notify(makeTask({ id: 'task-1', title: 'My Movie' }))
    expect(h.sent[0].text).not.toContain('Папка')
  })

  it('no-op when owner_chat_id not set', async () => {
    const h = makeHarness(undefined)
    await h.notifier.notify(makeTask({ id: 'task-1' }))
    expect(h.sent).toHaveLength(0)
  })

  it('grouped push uses ✅ Скачано (N) header', async () => {
    const h = makeHarness('12345')
    await h.notifier.notifyFinishedGrouped([
      makeTask({ id: '1', title: 'A' }),
      makeTask({ id: '2', title: 'B' }),
      makeTask({ id: '3', title: 'C' }),
    ])

    expect(h.sent[0].text).toContain('✅ Скачано (3):')
    expect(h.sent[0].text).toContain('• A')
  })

  it('grouped push truncates to 10 with "и ещё N" tail', async () => {
    const h = makeHarness('12345')
    const tasks = Array.from({ length: 15 }, (_, i) => makeTask({ id: String(i), title: `T${i}` }))
    await h.notifier.notifyFinishedGrouped(tasks)
    expect(h.sent[0].text).toContain('...и ещё 5')
    expect(h.sent[0].text).not.toContain('• T10')
  })

  it('asCallback returns a function that calls notify', async () => {
    const h = makeHarness('12345')
    const cb = h.notifier.asCallback()
    await cb(makeTask({ id: 'task-1', title: 'Callback Movie' }))
    expect(h.sent[0].text).toContain('Callback Movie')
  })

  it('finished push carries no Открыть button when MINIAPP_URL unset', async () => {
    const h = makeHarness('12345') // empty miniappUrl
    await h.notifier.notify(makeTask({ id: 'task-1', title: 'My Movie' }))
    expect(h.sent[0].replyMarkup).toBeUndefined()
  })

  it('finished push carries an Открыть(downloads) web_app button when MINIAPP_URL set', async () => {
    const h = makeHarness('12345', 'https://nas.example.com')
    await h.notifier.notify(makeTask({ id: 'task-1', title: 'My Movie' }))
    const markup = h.sent[0].replyMarkup
    expect(markup).toBeDefined()
    const btn = markup!.inline_keyboard[0][0] as { text: string; web_app: { url: string } }
    expect(btn.text).toBe('Открыть')
    expect(btn.web_app.url).toContain('tgWebAppStartParam=downloads')
  })

  it('grouped finished push carries the Открыть(downloads) button when set', async () => {
    const h = makeHarness('12345', 'https://nas.example.com')
    await h.notifier.notifyFinishedGrouped([makeTask({ id: '1', title: 'A' })])
    const markup = h.sent[0].replyMarkup
    expect(markup).toBeDefined()
    const btn = markup!.inline_keyboard[0][0] as { web_app: { url: string } }
    expect(btn.web_app.url).toContain('tgWebAppStartParam=downloads')
  })
})
