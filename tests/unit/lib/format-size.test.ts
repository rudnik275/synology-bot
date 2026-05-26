import { describe, it, expect } from 'bun:test'
import {
  formatBytes,
  formatBytesPair,
  formatSpeed,
  pickByteUnit,
} from '../../../src/lib/format-size.ts'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB
const TB = 1024 * GB

describe('formatBytes', () => {
  it('renders whole bytes below 1 KB without decimals', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('crosses to KB at exactly 1024 B', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 5)).toBe('5.0 KB')
    expect(formatBytes(1024 * 47)).toBe('47 KB')
    expect(formatBytes(1024 * 512)).toBe('512 KB')
  })

  it('crosses to MB at 1024 KB', () => {
    expect(formatBytes(MB)).toBe('1.0 MB')
    expect(formatBytes(MB * 9)).toBe('9.0 MB')
    expect(formatBytes(MB * 47)).toBe('47 MB')
    expect(formatBytes(MB * 200)).toBe('200 MB')
  })

  it('crosses to GB at 1024 MB', () => {
    expect(formatBytes(GB)).toBe('1.0 GB')
    expect(formatBytes(GB * 1.7)).toBe('1.7 GB')
    expect(formatBytes(GB * 47)).toBe('47 GB')
  })

  it('crosses to TB at 1024 GB', () => {
    expect(formatBytes(TB)).toBe('1.0 TB')
    expect(formatBytes(TB * 3.5)).toBe('3.5 TB')
  })

  it('uses 1 decimal under 10, 0 decimals at or above 10', () => {
    expect(formatBytes(GB * 1.5)).toBe('1.5 GB')
    expect(formatBytes(GB * 9.9)).toBe('9.9 GB')
    expect(formatBytes(GB * 10)).toBe('10 GB')
    expect(formatBytes(GB * 99.4)).toBe('99 GB')
  })
})

describe('formatBytesPair', () => {
  it('scales both numbers to the unit of total', () => {
    // 0.95 GB rounds to 0.9 via JS toFixed(1) on the binary-approximated
    // value — that's fine, we're not running a calculator, we're labelling
    // a chat message.
    expect(formatBytesPair(GB * 0.95, GB * 1.7)).toBe('0.9 / 1.7 GB')
    expect(formatBytesPair(TB * 2.4, TB * 3.5)).toBe('2.4 / 3.5 TB')
  })

  it('handles used much smaller than total (used drops below 1 in unit)', () => {
    // 5 GB / 2 TB → unit is TB, so 5 GB = 0.0 TB. Acceptable trade-off for
    // readability: the *total* sets the unit, the relationship stays clear.
    const result = formatBytesPair(GB * 5, TB * 2)
    expect(result.endsWith('TB')).toBe(true)
    expect(result).toContain(' / 2.0 TB')
  })

  it('used == total renders cleanly', () => {
    expect(formatBytesPair(GB * 1.7, GB * 1.7)).toBe('1.7 / 1.7 GB')
  })
})

describe('formatSpeed', () => {
  it('appends /s suffix to all unit tiers', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(1024)).toBe('1.0 KB/s')
    expect(formatSpeed(MB * 8.4)).toBe('8.4 MB/s')
    expect(formatSpeed(GB * 1)).toBe('1.0 GB/s')
  })
})

describe('pickByteUnit', () => {
  it('returns the highest unit where the value is ≥ 1', () => {
    expect(pickByteUnit(0)).toBe('B')
    expect(pickByteUnit(1023)).toBe('B')
    expect(pickByteUnit(1024)).toBe('KB')
    expect(pickByteUnit(MB)).toBe('MB')
    expect(pickByteUnit(GB)).toBe('GB')
    expect(pickByteUnit(TB)).toBe('TB')
  })
})
