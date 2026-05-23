import { describe, it, expect } from 'bun:test'
import { Notifier } from '../../../../src/domain/notifier/notifier.ts'
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
  sent: Array<{ chatId: number; text: string }>
  ownerChatId: string | undefined
}

function makeHarness(ownerChatId?: string): TestHarness {
  const sent: Array<{ chatId: number; text: string }> = []

  const harness: TestHarness = {
    ownerChatId,
    notifier: new Notifier(
      { getKv: (key) => key === 'owner_chat_id' ? harness.ownerChatId : undefined },
      async (chatId, text) => { sent.push({ chatId, text }) }
    ),
    sent,
  }

  return harness
}

describe('Notifier', () => {
  it('sends message to owner with ✅ prefix', async () => {
    const h = makeHarness('12345')
    const task = makeTask({ id: 'task-1', title: 'My Movie' })

    await h.notifier.notify(task)

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].chatId).toBe(12345)
    expect(h.sent[0].text).toContain('✅ Скачано: My Movie')
  })

  it('includes destination when present', async () => {
    const h = makeHarness('12345')
    const task = makeTask({
      id: 'task-1',
      title: 'My Movie',
      additional: { detail: { destination: '/volume1/video' } },
    })

    await h.notifier.notify(task)

    expect(h.sent[0].text).toContain('Папка: /volume1/video')
  })

  it('omits Папка line when destination is missing', async () => {
    const h = makeHarness('12345')
    const task = makeTask({ id: 'task-1', title: 'My Movie' })

    await h.notifier.notify(task)

    expect(h.sent[0].text).not.toContain('Папка')
  })

  it('no-op when owner_chat_id not set', async () => {
    const h = makeHarness(undefined)
    const task = makeTask({ id: 'task-1' })

    await h.notifier.notify(task)

    expect(h.sent).toHaveLength(0)
  })

  it('numeric chatId conversion works correctly', async () => {
    const h = makeHarness('987654321')
    const task = makeTask({ id: 'task-1' })

    await h.notifier.notify(task)

    expect(h.sent[0].chatId).toBe(987654321)
  })

  it('asCallback returns a function that calls notify', async () => {
    const h = makeHarness('12345')
    const task = makeTask({ id: 'task-1', title: 'Callback Movie' })

    const cb = h.notifier.asCallback()
    await cb(task)

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].text).toContain('Callback Movie')
  })
})
