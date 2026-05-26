/**
 * Single source of truth for "make N bytes look nice in Telegram".
 *
 * Three call shapes cover every case in the bot:
 *  • `formatBytes(n)` — auto-scale a standalone number ("47 MB", "1.7 GB").
 *  • `formatBytesPair(used, total)` — two numbers sharing a unit ("0.9 / 1.7 GB").
 *  • `formatSpeed(bytesPerSec)` — like `formatBytes` but with a "/s" suffix.
 *
 * Conventions used everywhere:
 *  • Binary base (KB = 1024 B, MB = 1024 KB, …) — matches DSM and `free -m`.
 *  • Latin unit labels (B / KB / MB / GB / TB), not Cyrillic — the rest of
 *    the bot's numeric strings already use Latin.
 *  • Decimals: 1 if the scaled value is below 10 ("1.5 GB", "9.4 GB"),
 *    0 otherwise ("47 GB", "512 GB"). Whole bytes never get a decimal.
 */

export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB
const TB = 1024 * GB

/** Pick the largest unit where the scaled number is still ≥ 1. */
export function pickByteUnit(bytes: number): ByteUnit {
  const abs = Math.abs(bytes)
  if (abs >= TB) return 'TB'
  if (abs >= GB) return 'GB'
  if (abs >= MB) return 'MB'
  if (abs >= KB) return 'KB'
  return 'B'
}

function divisor(unit: ByteUnit): number {
  switch (unit) {
    case 'TB': return TB
    case 'GB': return GB
    case 'MB': return MB
    case 'KB': return KB
    case 'B':  return 1
  }
}

function renderValue(bytes: number, unit: ByteUnit): string {
  if (unit === 'B') return String(Math.round(bytes))
  const v = bytes / divisor(unit)
  return v < 10 ? v.toFixed(1) : v.toFixed(0)
}

/** "47 MB", "1.7 GB", "3.5 TB". */
export function formatBytes(bytes: number): string {
  const unit = pickByteUnit(bytes)
  return `${renderValue(bytes, unit)} ${unit}`
}

/**
 * "0.9 / 1.7 GB" — both values scaled to `total`'s unit so the comparison
 * reads naturally. Unit suffix appears once at the end.
 */
export function formatBytesPair(used: number, total: number): string {
  const unit = pickByteUnit(total)
  return `${renderValue(used, unit)} / ${renderValue(total, unit)} ${unit}`
}

/** "1.5 KB/s", "8.4 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}
