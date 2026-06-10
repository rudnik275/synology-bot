/**
 * Runtime-tunable settings (#305). Persisted in the existing SQLite KV store
 * under `setting:*` keys; env/config defaults are the fallback when a key is
 * absent or holds an invalid value. Watchers read these through getter
 * functions per tick, so a change from the Mini App applies without restart
 * (the digest hour applies on the next schedule cycle or restart).
 */

export interface AppSettings {
  /** Disk-usage hysteresis: usedPct >= high fires a warning. 50–99. */
  diskUsageHighPct: number
  /** Disk-usage hysteresis: usedPct < low clears a warning. 1–98, < high. */
  diskUsageLowPct: number
  /** Disk temperature warning band start, °C. 25–80, < bad. */
  diskTempWarnC: number
  /** Disk temperature alert threshold, °C. 30–90. */
  diskTempBadC: number
  /** Local hour-of-day (0–23) for the daily digest. */
  digestHour: number
  /** Auto-cleaner retention for completed task entries, days. 1–60. */
  autoCleanerRetentionDays: number
}

export type SettingsField = keyof AppSettings

interface FieldDef {
  field: SettingsField
  kvKey: string
  min: number
  max: number
}

export const SETTING_FIELDS: readonly FieldDef[] = [
  { field: 'diskUsageHighPct', kvKey: 'setting:disk-usage-high', min: 50, max: 99 },
  { field: 'diskUsageLowPct', kvKey: 'setting:disk-usage-low', min: 1, max: 98 },
  { field: 'diskTempWarnC', kvKey: 'setting:disk-temp-warn', min: 25, max: 80 },
  { field: 'diskTempBadC', kvKey: 'setting:disk-temp-bad', min: 30, max: 90 },
  { field: 'digestHour', kvKey: 'setting:digest-hour', min: 0, max: 23 },
  { field: 'autoCleanerRetentionDays', kvKey: 'setting:auto-cleaner-retention', min: 1, max: 60 },
] as const

/** Narrow slice of PersistentStore the settings provider needs. */
export interface SettingsKv {
  getKv(key: string): string | undefined
  setKv(key: string, value: string): void
}

export type SettingsUpdateResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; errors: Partial<Record<SettingsField, string>> }

export interface SettingsProvider {
  /** Current effective settings: KV overrides merged over config defaults. */
  get(): AppSettings
  /** Validate + persist a partial update. Nothing is written when invalid. */
  update(patch: Record<string, unknown>): SettingsUpdateResult
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Cross-field invariants on a fully-merged settings object. Returned errors
 * are attached to the field the user most likely edited last (the low/warn
 * side carries the message too, so inline UI can highlight both).
 */
function crossFieldErrors(s: AppSettings): Partial<Record<SettingsField, string>> {
  const errors: Partial<Record<SettingsField, string>> = {}
  if (s.diskUsageLowPct >= s.diskUsageHighPct) {
    errors.diskUsageLowPct = `must be lower than high threshold (${s.diskUsageHighPct}%)`
    errors.diskUsageHighPct = `must be higher than low threshold (${s.diskUsageLowPct}%)`
  }
  if (s.diskTempWarnC >= s.diskTempBadC) {
    errors.diskTempWarnC = `must be lower than bad threshold (${s.diskTempBadC}°C)`
    errors.diskTempBadC = `must be higher than warn threshold (${s.diskTempWarnC}°C)`
  }
  return errors
}

export function createSettingsProvider(kv: SettingsKv, defaults: AppSettings): SettingsProvider {
  function get(): AppSettings {
    const settings = { ...defaults }
    for (const def of SETTING_FIELDS) {
      const raw = kv.getKv(def.kvKey)
      if (raw === undefined) continue
      const parsed = Number(raw)
      // Stale/corrupt KV values silently fall back to the config default —
      // a bad row must never break the watchers.
      if (isIntInRange(parsed, def.min, def.max)) {
        settings[def.field] = parsed
      }
    }
    // Pairs that ended up violating their invariant (e.g. only one side was
    // stored, or defaults moved) revert to defaults as a pair.
    if (settings.diskUsageLowPct >= settings.diskUsageHighPct) {
      settings.diskUsageHighPct = defaults.diskUsageHighPct
      settings.diskUsageLowPct = defaults.diskUsageLowPct
    }
    if (settings.diskTempWarnC >= settings.diskTempBadC) {
      settings.diskTempWarnC = defaults.diskTempWarnC
      settings.diskTempBadC = defaults.diskTempBadC
    }
    return settings
  }

  function update(patch: Record<string, unknown>): SettingsUpdateResult {
    const errors: Partial<Record<SettingsField, string>> = {}
    const accepted: Partial<Record<SettingsField, number>> = {}

    for (const def of SETTING_FIELDS) {
      if (!(def.field in patch)) continue
      const value = patch[def.field]
      if (!isIntInRange(value, def.min, def.max)) {
        errors[def.field] = `must be an integer between ${def.min} and ${def.max}`
        continue
      }
      accepted[def.field] = value
    }

    if (Object.keys(errors).length === 0) {
      const merged = { ...get(), ...accepted }
      Object.assign(errors, crossFieldErrors(merged))
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors }

    for (const def of SETTING_FIELDS) {
      const value = accepted[def.field]
      if (value !== undefined) kv.setKv(def.kvKey, String(value))
    }
    return { ok: true, settings: get() }
  }

  return { get, update }
}
