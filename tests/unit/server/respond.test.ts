/**
 * Unit tests for respondResult, requireString, requireIntArray helpers.
 * Written test-first (TDD) per issue #179 (tdd-required).
 */
import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { respondResult, requireString, requireIntArray } from '../../../src/server/respond.ts'
import type { Result } from '../../../src/lib/result.ts'

// ─── respondResult ────────────────────────────────────────────────────────────

describe('respondResult', () => {
  it('returns 200 with the data payload on ok Result<T>', async () => {
    const app = new Hono()
    app.get('/test', (c) => {
      const result: Result<{ name: string }> = { ok: true, data: { name: 'hello' } }
      return respondResult(c, result)
    })
    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'hello' })
  })

  it('returns the supplied okStatus on ok Result<T>', async () => {
    const app = new Hono()
    app.get('/test', (c) => {
      const result: Result<{ id: string }> = { ok: true, data: { id: 'x' } }
      return respondResult(c, result, { okStatus: 201 })
    })
    const res = await app.request('/test')
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'x' })
  })

  it('returns 200 with { ok: true } on void Result (command)', async () => {
    const app = new Hono()
    app.get('/test', (c) => {
      const result: Result = { ok: true }
      return respondResult(c, result)
    })
    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 502 with { error } on failure Result', async () => {
    const app = new Hono()
    app.get('/test', (c) => {
      const result: Result = { ok: false, reason: 'upstream down' }
      return respondResult(c, result)
    })
    const res = await app.request('/test')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream unavailable' })
  })

  it('returns okStatus-suppressed 502 on failure regardless of okStatus', async () => {
    const app = new Hono()
    app.get('/test', (c) => {
      const result: Result<string> = { ok: false, reason: 'nope' }
      return respondResult(c, result, { okStatus: 201 })
    })
    const res = await app.request('/test')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream unavailable' })
  })
})

// ─── requireString ────────────────────────────────────────────────────────────

describe('requireString', () => {
  it('returns the value when field is a non-empty string', () => {
    const result = requireString({ name: 'alice' }, 'name')
    expect(result).toEqual({ ok: true, value: 'alice' })
  })

  it('rejects when the field is missing (undefined)', () => {
    const result = requireString({}, 'name')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('name')
  })

  it('rejects when the field is an empty string', () => {
    const result = requireString({ name: '' }, 'name')
    expect(result.ok).toBe(false)
  })

  it('rejects when the field is not a string (number)', () => {
    const result = requireString({ name: 42 }, 'name')
    expect(result.ok).toBe(false)
  })

  it('rejects when the body is null', () => {
    const result = requireString(null, 'name')
    expect(result.ok).toBe(false)
  })
})

// ─── requireIntArray ──────────────────────────────────────────────────────────

describe('requireIntArray', () => {
  it('returns the array when field is an integer array', () => {
    const result = requireIntArray({ selected: [0, 1, 5] }, 'selected')
    expect(result).toEqual({ ok: true, value: [0, 1, 5] })
  })

  it('accepts an empty integer array', () => {
    const result = requireIntArray({ selected: [] }, 'selected')
    expect(result).toEqual({ ok: true, value: [] })
  })

  it('rejects when the field is missing', () => {
    const result = requireIntArray({}, 'selected')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('selected')
  })

  it('rejects when the array contains non-integer values', () => {
    const result = requireIntArray({ selected: ['a', 'b'] }, 'selected')
    expect(result.ok).toBe(false)
  })

  it('rejects when the array contains floats', () => {
    const result = requireIntArray({ selected: [1.5] }, 'selected')
    expect(result.ok).toBe(false)
  })

  it('rejects when the field is not an array', () => {
    const result = requireIntArray({ selected: 'not-array' }, 'selected')
    expect(result.ok).toBe(false)
  })

  it('rejects when the body is null', () => {
    const result = requireIntArray(null, 'selected')
    expect(result.ok).toBe(false)
  })
})
