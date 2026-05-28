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
