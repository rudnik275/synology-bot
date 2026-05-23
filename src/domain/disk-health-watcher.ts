import type { DiskInfo } from '../infra/synology/types.ts'

export type DiskHealthState = 'ok' | 'hot' | 'warn'

export interface DiskHealthWatcherDeps {
  /** Fetch current disk info from Synology */
  getDiskInfo: () => Promise<{ ok: true; data: DiskInfo } | { ok: false; reason: string }>
  /** Read per-event state for a disk, keyed by (event, resourceId). Returns 'ok' if unknown. */
  getState: (event: string, resourceId: string) => DiskHealthState
  /** Persist per-event state for a disk */
  setState: (event: string, resourceId: string, state: DiskHealthState) => void
  /** Send a push notification message to the owner */
  notify: (message: string) => Promise<void>
  /** Temperature threshold to enter hot state (°C, inclusive) */
  tempHigh: number
  /** Temperature threshold to leave hot state (°C, inclusive) */
  tempLow: number
}

/**
 * DiskHealthWatcher checks disk temperature and SMART status on each poll tick.
 *
 * Temperature state machine (per disk):
 *   ok  → hot   when temp >= tempHigh  (push: 🌡 overheating alert)
 *   hot → ok    when temp <= tempLow   (push: ✅ recovery)
 *   Hysteresis band: tempLow < temp < tempHigh keeps current state unchanged.
 *
 * SMART state machine (per disk):
 *   ok   → warn  when smart_status !== 'normal' OR status !== 'normal'  (push: ❌ SMART alert)
 *   warn → ok    when both return to 'normal'                            (push: ✅ recovery)
 *
 * Both checks are independent per disk. State is persisted via getState/setState so it
 * survives restart without duplicate alerts.
 */
export class DiskHealthWatcher {
  private readonly deps: DiskHealthWatcherDeps

  constructor(deps: DiskHealthWatcherDeps) {
    this.deps = deps
  }

  async check(): Promise<void> {
    let result: { ok: true; data: DiskInfo } | { ok: false; reason: string }

    try {
      result = await this.deps.getDiskInfo()
    } catch (err) {
      console.error('[DiskHealthWatcher] getDiskInfo threw:', err)
      return
    }

    if (!result.ok) {
      console.warn('[DiskHealthWatcher] getDiskInfo failed:', result.reason)
      return
    }

    for (const disk of result.data.disks) {
      await this.checkTemperature(disk.id, disk.model, disk.temp)
      await this.checkSmart(disk.id, disk.model, disk.smart_status, disk.status)
    }
  }

  private async checkTemperature(diskId: string, model: string, temp: number): Promise<void> {
    const event = 'disk_temp'
    const currentState = this.deps.getState(event, diskId)

    if (currentState === 'ok') {
      if (temp >= this.deps.tempHigh) {
        this.deps.setState(event, diskId, 'hot')
        await this.deps.notify(`🌡 ${model} перегрев: ${temp}°C`)
      }
      // Below tempHigh: stay ok, no action
    } else {
      // Currently hot
      if (temp <= this.deps.tempLow) {
        this.deps.setState(event, diskId, 'ok')
        await this.deps.notify(`✅ ${model} температура в норме (${temp}°C)`)
      }
      // Between tempLow and tempHigh: hysteresis — stay hot, no action
    }
  }

  private async checkSmart(diskId: string, model: string, smartStatus: string, diskStatus: string): Promise<void> {
    const event = 'disk_smart'
    const isNormal = smartStatus === 'normal' && diskStatus === 'normal'
    const currentState = this.deps.getState(event, diskId)

    if (currentState === 'ok') {
      if (!isNormal) {
        this.deps.setState(event, diskId, 'warn')
        await this.deps.notify(`❌ ${model} SMART: ${smartStatus}, status: ${diskStatus}`)
      }
    } else {
      // Currently warn
      if (isNormal) {
        this.deps.setState(event, diskId, 'ok')
        await this.deps.notify(`✅ ${model} SMART восстановлен`)
      }
    }
  }
}
