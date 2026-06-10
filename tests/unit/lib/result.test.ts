import { describe, it, expect } from 'bun:test'
import { ok, err, tryResult, toHttpError, type Result } from '../../../src/lib/result.ts'

describe('lib/result — ok()', () => {
  it('wraps data into a success Result', () => {
    const r = ok(42)
    expect(r).toEqual({ ok: true, data: 42 })
  })

  it('produces a bare command success when called with no data', () => {
    const r = ok()
    expect(r).toEqual({ ok: true })
  })
})

describe('lib/result — err()', () => {
  it('wraps a reason into a failure Result', () => {
    const r = err('boom')
    expect(r).toEqual({ ok: false, reason: 'boom' })
  })
})

describe('lib/result — tryResult()', () => {
  it('returns ok(data) when the wrapped fn resolves', async () => {
    const r = await tryResult(async () => 'value')
    expect(r).toEqual({ ok: true, data: 'value' })
  })

  it('returns err(message) when the wrapped fn throws an Error', async () => {
    const r = await tryResult(async () => { throw new Error('exploded') })
    expect(r).toEqual({ ok: false, reason: 'exploded' })
  })

  it('stringifies a non-Error throw into the reason', async () => {
    const r = await tryResult(async () => { throw 'plain string' })
    expect(r).toEqual({ ok: false, reason: 'plain string' })
  })

  it('works with a synchronous fn that returns a value', async () => {
    const r = await tryResult(() => 7)
    expect(r).toEqual({ ok: true, data: 7 })
  })

  it('catches a synchronous throw', async () => {
    const r = await tryResult(() => { throw new Error('sync boom') })
    expect(r).toEqual({ ok: false, reason: 'sync boom' })
  })
})

describe('lib/result — toHttpError()', () => {
  it('maps a failure Result to a generic { error }, 502 tuple — no reason leak', () => {
    const r: Result<number> = err('upstream down')
    const [body, status] = toHttpError(r)
    expect(body).toEqual({ error: 'upstream unavailable' })
    expect(status).toBe(502)
  })
})
