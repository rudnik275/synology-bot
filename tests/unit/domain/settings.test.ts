// Settings provider (#305): KV-persisted overrides with config defaults as
// fallback, range validation + cross-field invariants on update.
import { describe, it, expect } from 'bun:test'
import { createSettingsProvider, type AppSettings, type SettingsKv } from '../../../src/domain/settings.ts'

const DEFAULTS: AppSettings = {
  diskUsageHighPct: 90,
  diskUsageLowPct: 85,
  diskTempWarnC: 50,
  diskTempBadC: 56,
  digestHour: 9,
  autoCleanerRetentionDays: 7,
}

function makeKv(initial: Record<string, string> = {}): SettingsKv & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    map,
    getKv: (key) => map.get(key),
    setKv: (key, value) => { map.set(key, value) },
  }
}

describe('createSettingsProvider — get()', () => {
  it('returns config defaults when KV is empty', () => {
    const provider = createSettingsProvider(makeKv(), DEFAULTS)
    expect(provider.get()).toEqual(DEFAULTS)
  })

  it('KV overrides take precedence over defaults', () => {
    const kv = makeKv({
      'setting:disk-usage-high': '95',
      'setting:digest-hour': '18',
      'setting:auto-cleaner-retention': '14',
    })
    const provider = createSettingsProvider(kv, DEFAULTS)
    const s = provider.get()
    expect(s.diskUsageHighPct).toBe(95)
    expect(s.digestHour).toBe(18)
    expect(s.autoCleanerRetentionDays).toBe(14)
    // untouched fields keep their defaults
    expect(s.diskUsageLowPct).toBe(85)
    expect(s.diskTempWarnC).toBe(50)
  })

  it('non-numeric / out-of-range / fractional KV values fall back to defaults', () => {
    const kv = makeKv({
      'setting:disk-usage-high': 'banana',
      'setting:digest-hour': '99',
      'setting:auto-cleaner-retention': '7.5',
    })
    const provider = createSettingsProvider(kv, DEFAULTS)
    expect(provider.get()).toEqual(DEFAULTS)
  })

  it('a stored pair violating low < high reverts the pair to defaults', () => {
    const kv = makeKv({ 'setting:disk-usage-low': '95' }) // default high is 90
    const provider = createSettingsProvider(kv, DEFAULTS)
    expect(provider.get().diskUsageHighPct).toBe(90)
    expect(provider.get().diskUsageLowPct).toBe(85)
  })

  it('a stored pair violating warn < bad reverts the pair to defaults', () => {
    const kv = makeKv({ 'setting:disk-temp-warn': '60' }) // default bad is 56
    const provider = createSettingsProvider(kv, DEFAULTS)
    expect(provider.get().diskTempWarnC).toBe(50)
    expect(provider.get().diskTempBadC).toBe(56)
  })
})

describe('createSettingsProvider — update()', () => {
  it('persists a valid partial update and returns the merged settings', () => {
    const kv = makeKv()
    const provider = createSettingsProvider(kv, DEFAULTS)
    const result = provider.update({ diskUsageHighPct: 92, digestHour: 20 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.diskUsageHighPct).toBe(92)
      expect(result.settings.digestHour).toBe(20)
    }
    expect(kv.map.get('setting:disk-usage-high')).toBe('92')
    expect(kv.map.get('setting:digest-hour')).toBe('20')
    // re-read through a fresh provider over the same KV (round-trip)
    expect(createSettingsProvider(kv, DEFAULTS).get().diskUsageHighPct).toBe(92)
  })

  it('rejects out-of-range values with per-field errors and writes nothing', () => {
    const kv = makeKv()
    const provider = createSettingsProvider(kv, DEFAULTS)
    const result = provider.update({ diskUsageHighPct: 100, digestHour: 24, autoCleanerRetentionDays: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.diskUsageHighPct).toBeDefined()
      expect(result.errors.digestHour).toBeDefined()
      expect(result.errors.autoCleanerRetentionDays).toBeDefined()
    }
    expect(kv.map.size).toBe(0)
  })

  it('rejects non-integer values', () => {
    const provider = createSettingsProvider(makeKv(), DEFAULTS)
    const result = provider.update({ digestHour: 9.5 })
    expect(result.ok).toBe(false)
    const result2 = provider.update({ digestHour: '9' })
    expect(result2.ok).toBe(false)
  })

  it('rejects low >= high (cross-field, merged against current settings)', () => {
    const kv = makeKv()
    const provider = createSettingsProvider(kv, DEFAULTS)
    const result = provider.update({ diskUsageLowPct: 90 }) // current high is 90
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.diskUsageLowPct).toContain('lower')
    expect(kv.map.size).toBe(0)
  })

  it('rejects tempWarn >= tempBad (cross-field)', () => {
    const provider = createSettingsProvider(makeKv(), DEFAULTS)
    const result = provider.update({ diskTempWarnC: 60, diskTempBadC: 58 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.diskTempWarnC).toBeDefined()
      expect(result.errors.diskTempBadC).toBeDefined()
    }
  })

  it('accepts a consistent pair update that crosses the old values', () => {
    const provider = createSettingsProvider(makeKv(), DEFAULTS)
    const result = provider.update({ diskUsageHighPct: 80, diskUsageLowPct: 75 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.diskUsageHighPct).toBe(80)
      expect(result.settings.diskUsageLowPct).toBe(75)
    }
  })

  it('ignores unknown fields in the patch', () => {
    const kv = makeKv()
    const provider = createSettingsProvider(kv, DEFAULTS)
    const result = provider.update({ evil: 1, digestHour: 7 })
    expect(result.ok).toBe(true)
    expect(kv.map.has('evil')).toBe(false)
    expect(kv.map.get('setting:digest-hour')).toBe('7')
  })
})
