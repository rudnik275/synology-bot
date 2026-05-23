import type { StorageInfo } from '../infra/synology/types.ts'

export interface DiskUsageWatcherDeps {
  /** Fetch current storage info from Synology. Returns ok:false on error. */
  getStorageInfo: () => Promise<{ ok: true; data: StorageInfo } | { ok: false; reason: string }>
  /** Returns true if the volume is in the warned (disk_full) state in the store. */
  isVolumeWarned: (volumeId: string) => Promise<boolean>
  /** Persist the warned state for a volume (ok → warn transition). */
  markWarned: (volumeId: string) => Promise<void>
  /** Clear the warned state for a volume (warn → ok transition). */
  clearWarned: (volumeId: string) => Promise<void>
  /** Send a notification message to the owner. */
  notify: (message: string) => Promise<void>
  /** Upper threshold (inclusive): usedPct >= highPct triggers a warning. Default 90. */
  highPct: number
  /** Lower threshold (exclusive): usedPct < lowPct clears a warning. Default 85. */
  lowPct: number
}

/**
 * DiskUsageWatcher is a pure, I/O-free state machine (all deps injected).
 *
 * Hysteresis:
 *   ok  → warn : usedPct >= highPct  (send ⚠️, markWarned)
 *   warn → ok  : usedPct <  lowPct   (send ✅, clearWarned)
 *   hysteresis band [lowPct, highPct): no transition
 *
 * State is persisted in `health_dedup` via the injected helpers so it
 * survives restarts without re-firing alerts.
 */
export class DiskUsageWatcher {
  private readonly deps: DiskUsageWatcherDeps

  constructor(deps: DiskUsageWatcherDeps) {
    this.deps = deps
  }

  async check(): Promise<void> {
    const result = await this.deps.getStorageInfo()

    if (!result.ok) {
      console.warn('[DiskUsageWatcher] getStorageInfo failed:', result.reason)
      return
    }

    const { volumes } = result.data

    for (const volume of volumes) {
      try {
        await this.checkVolume(volume)
      } catch (err) {
        console.error(`[DiskUsageWatcher] Unexpected error checking volume ${volume.id}:`, err)
      }
    }
  }

  private async checkVolume(volume: StorageInfo['volumes'][number]): Promise<void> {
    const total = Number(volume.size.total)
    const used = Number(volume.size.used)

    if (total === 0) return

    const usedPct = (used / total) * 100
    const isWarned = await this.deps.isVolumeWarned(volume.id)

    if (!isWarned && usedPct >= this.deps.highPct) {
      // ok → warn: crossed high threshold
      await this.deps.markWarned(volume.id)
      const pctDisplay = Math.round(usedPct)
      const usedGb = this.formatBytes(used)
      const totalGb = this.formatBytes(total)
      await this.deps.notify(
        `⚠️ ${volume.name} заполнен на ${pctDisplay}% (${usedGb}/${totalGb})`
      )
    } else if (isWarned && usedPct < this.deps.lowPct) {
      // warn → ok: dropped below low threshold
      await this.deps.clearWarned(volume.id)
      const pctDisplay = Math.round(usedPct)
      await this.deps.notify(
        `✅ ${volume.name} восстановлен (${pctDisplay}% использовано)`
      )
    }
    // Otherwise: no transition (hysteresis band or already in correct state)
  }

  private formatBytes(bytes: number): string {
    const tb = bytes / 1_099_511_627_776
    if (tb >= 1) return `${tb.toFixed(1)} ТБ`
    const gb = bytes / 1_073_741_824
    if (gb >= 1) return `${gb.toFixed(1)} ГБ`
    const mb = bytes / 1_048_576
    return `${mb.toFixed(0)} МБ`
  }
}
