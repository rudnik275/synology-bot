const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Human-readable byte size, matching the bot's formatter feel (1 decimal from MB up). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  return `${i >= 2 ? value.toFixed(1) : Math.round(value)} ${UNITS[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '—'
}

/**
 * Compact percentage for display. Per-process %CPU arrives from DSM as a long
 * float (e.g. 0.0361445783) that overflows its column; round it. ≥10% → integer,
 * below → one decimal, and a tiny-but-nonzero value reads "<0.1%" so a busy-ish
 * process is never flattened to a misleading "0%".
 */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}
