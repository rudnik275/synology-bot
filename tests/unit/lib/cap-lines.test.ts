import { describe, it, expect } from 'bun:test'
import { capLines } from '../../../src/lib/cap-lines.ts'

describe('capLines (#298)', () => {
  it('returns header + all lines when under the limit', () => {
    expect(capLines('H:', ['a', 'b'])).toBe('H:\na\nb')
  })

  it('drops tail lines and appends «…и ещё N» when over the limit', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line number ${i} — ${'x'.repeat(20)}`)
    const out = capLines('Header:', lines)

    expect(out.length).toBeLessThanOrEqual(4000)
    expect(out).toMatch(/…и ещё \d+$/)
    expect(out.startsWith('Header:\nline number 0')).toBe(true)
  })

  it('hidden count matches the number of dropped lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `item-${i}`)
    const out = capLines('H', lines, 40)
    const kept = out.split('\n').filter((l) => l.startsWith('item-')).length
    const hidden = Number(out.match(/…и ещё (\d+)$/)?.[1])
    expect(kept + hidden).toBe(10)
    expect(out.length).toBeLessThanOrEqual(40)
  })

  it('keeps at least the header even with an absurdly small budget', () => {
    const out = capLines('Header', ['aaaaaaaaaa'], 5)
    expect(out).toContain('Header')
    expect(out).toContain('…и ещё 1')
  })
})
