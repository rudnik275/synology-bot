import { describe, it, expect } from 'bun:test'
import { DeployReporter, type DeployReporterDeps } from '../../../src/domain/deploy-reporter.ts'

interface Harness {
  reporter: DeployReporter
  sent: string[]
  storedSha: string | undefined
}

function makeHarness(opts: {
  currentSha?: string
  lastSha?: string
  throwOnGet?: boolean
  version?: string
} = {}): Harness {
  const state: { lastSha: string | undefined } = { lastSha: opts.lastSha }
  const sent: string[] = []
  const deps: DeployReporterDeps = {
    getOwnImageId: async () => {
      if (opts.throwOnGet) throw new Error('socket down')
      return opts.currentSha ?? 'sha256:current'
    },
    getLastImageId: () => state.lastSha,
    setLastImageId: (sha) => { state.lastSha = sha },
    version: opts.version ?? '1.2.3',
    notify: async (m) => { sent.push(m) },
  }
  return {
    reporter: new DeployReporter(deps),
    sent,
    get storedSha() { return state.lastSha },
  }
}

describe('DeployReporter', () => {
  it('primes baseline silently on first ever run', async () => {
    const h = makeHarness({ currentSha: 'sha256:aaa', lastSha: undefined })
    await h.reporter.report()
    expect(h.sent).toEqual([])
    expect(h.storedSha).toBe('sha256:aaa')
  })

  it('stays silent when image SHA is unchanged (plain restart)', async () => {
    const h = makeHarness({ currentSha: 'sha256:aaa', lastSha: 'sha256:aaa' })
    await h.reporter.report()
    expect(h.sent).toEqual([])
    expect(h.storedSha).toBe('sha256:aaa')
  })

  it('notifies and persists when image SHA changed', async () => {
    const h = makeHarness({
      currentSha: 'sha256:bbb',
      lastSha: 'sha256:aaa',
      version: '3.0.4',
    })
    await h.reporter.report()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('🚀 Деплой')
    expect(h.sent[0]).toContain('v3.0.4')
    expect(h.storedSha).toBe('sha256:bbb')
  })

  it('does not crash on docker errors — logs and returns', async () => {
    const h = makeHarness({ throwOnGet: true, lastSha: 'sha256:aaa' })
    await h.reporter.report()
    expect(h.sent).toEqual([])
    expect(h.storedSha).toBe('sha256:aaa')
  })

  it('does not notify when docker returns empty image SHA', async () => {
    const h = makeHarness({ currentSha: '', lastSha: 'sha256:aaa' })
    await h.reporter.report()
    expect(h.sent).toEqual([])
    expect(h.storedSha).toBe('sha256:aaa')
  })

  it('is idempotent — second call after notify is silent', async () => {
    const h = makeHarness({
      currentSha: 'sha256:bbb',
      lastSha: 'sha256:aaa',
    })
    await h.reporter.report()
    await h.reporter.report()
    expect(h.sent).toHaveLength(1)
  })
})
