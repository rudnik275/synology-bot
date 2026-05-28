import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { verifyInitData } from '../../../src/server/init-data.ts'

const BOT_TOKEN = '123456:TEST_TOKEN_abcdef'
const NOW_SEC = 1_700_000_000
const now = () => NOW_SEC * 1000

/** Build a correctly-signed initData string for the given fields. */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secretKey = new Uint8Array(createHmac('sha256', 'WebAppData').update(botToken).digest())
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(NOW_SEC),
    query_id: 'AAEtest',
    user: JSON.stringify({ id: 42, first_name: 'Owner', username: 'owner' }),
    ...overrides,
  }
}

describe('verifyInitData', () => {
  it('accepts a correctly-signed payload and returns the user', () => {
    const result = verifyInitData(signInitData(validFields()), BOT_TOKEN, { now })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.id).toBe(42)
      expect(result.user.username).toBe('owner')
      expect(result.authDate).toBe(NOW_SEC)
    }
  })

  it('rejects a tampered hash', () => {
    const raw = signInitData(validFields())
    const tampered = raw.replace(/hash=[0-9a-f]+/, 'hash=deadbeef')
    const result = verifyInitData(tampered, BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('rejects when a field is changed after signing', () => {
    const raw = signInitData(validFields())
    const params = new URLSearchParams(raw)
    params.set('auth_date', String(NOW_SEC + 1)) // mutate signed field, keep old hash
    const result = verifyInitData(params.toString(), BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('rejects when signed with a different bot token', () => {
    const raw = signInitData(validFields(), 'other:WRONG_TOKEN')
    const result = verifyInitData(raw, BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('rejects a missing hash', () => {
    const params = new URLSearchParams(validFields())
    const result = verifyInitData(params.toString(), BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'missing hash' })
  })

  it('rejects a missing user', () => {
    const fields = validFields()
    delete (fields as Record<string, string>).user
    const result = verifyInitData(signInitData(fields), BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'missing user' })
  })

  it('rejects a user without a numeric id', () => {
    const fields = validFields({ user: JSON.stringify({ first_name: 'NoId' }) })
    const result = verifyInitData(signInitData(fields), BOT_TOKEN, { now })
    expect(result).toEqual({ ok: false, reason: 'user has no id' })
  })

  it('rejects stale initData past maxAge', () => {
    const fields = validFields({ auth_date: String(NOW_SEC - 90_000) })
    const result = verifyInitData(signInitData(fields), BOT_TOKEN, { now }) // default 24h
    expect(result).toEqual({ ok: false, reason: 'initData expired' })
  })

  it('accepts stale initData when maxAge is disabled (0)', () => {
    const fields = validFields({ auth_date: String(NOW_SEC - 90_000) })
    const result = verifyInitData(signInitData(fields), BOT_TOKEN, { now, maxAgeSeconds: 0 })
    expect(result.ok).toBe(true)
  })
})
