/**
 * Module-level singleton composable for NAS health data.
 *
 * The useApi instance is created once at module scope with `immediate:false`
 * so no lifecycle hooks fire at module load time. Each call to `useHealth()`
 * inside a component registers its own `onMounted` / `onUnmounted` for the
 * shared polling timer, but all consumers share the same `data`/`loading`/
 * `error` refs — one fetch in flight, one cache, no drift.
 *
 * Wired by issue #70. Consumed by App.vue (chipStatus/chipMetric → HealthChip)
 * and NasTab.vue (full health view).
 */
import { computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import { useApi } from './useApi'
import type { HealthView } from '../types'
import type { HealthStatus } from '../components/health'

const POLL_MS = 15000

// One shared api instance at module scope. immediate:false — lifecycle wiring
// is handled below so it works correctly from a component context.
const api = useApi<HealthView>('/health', { immediate: false })

/** POSIX basename — last non-empty path segment. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function useHealth() {
  const { data, loading, error, refetch } = api

  // Wire lifecycle only when called inside a component setup().
  // Multiple consumers calling useHealth() each register a lifecycle pair,
  // but they all call the same `refetch` on the same shared refs — idempotent.
  if (getCurrentInstance()) {
    let timer: ReturnType<typeof setInterval> | undefined

    onMounted(() => {
      // Only fetch if we have no data yet (first consumer) to avoid double-fetch
      // when e.g. both App.vue and NasTab mount at the same time.
      if (!data.value) void refetch()
      timer = setInterval(() => void refetch(), POLL_MS)
    })

    onUnmounted(() => {
      if (timer) clearInterval(timer)
    })
  }

  /**
   * chipStatus: aggregate NAS health for the header chip.
   * - 'unknown' — no data yet
   * - 'bad'     — any disk failure/bad-smart, any volume pct >= 90
   * - 'warn'    — any volume pct >= 80, or any disk tempStatus 'elevated'
   * - 'ok'      — everything nominal
   */
  const chipStatus = computed((): HealthStatus => {
    if (!data.value) return 'unknown'

    const { volumes, disks } = data.value

    // bad: disk failure or smart failure
    if (disks) {
      for (const disk of disks) {
        const st = disk.status.toLowerCase()
        const sm = disk.smart.toLowerCase()
        if (st === 'failure' || st === 'failed' || st === 'bad' || sm === 'failed' || sm === 'failure') {
          return 'bad'
        }
      }
    }

    // bad: volume >= 90% or volume status failure
    if (volumes) {
      for (const vol of volumes) {
        if (vol.pct >= 90) return 'bad'
        const st = vol.status.toLowerCase()
        if (st === 'failure' || st === 'failed' || st === 'bad') return 'bad'
      }
    }

    // warn: volume >= 80%
    if (volumes) {
      for (const vol of volumes) {
        if (vol.pct >= 80) return 'warn'
      }
    }

    // warn: elevated disk temp
    if (disks) {
      for (const disk of disks) {
        if (disk.tempStatus.toLowerCase() === 'elevated') return 'warn'
      }
    }

    return 'ok'
  })

  /**
   * chipMetric: the busiest volume as "basename pct%" or "—" if no volumes.
   */
  const chipMetric = computed((): string => {
    const volumes = data.value?.volumes
    if (!volumes || volumes.length === 0) return '—'

    let busiest = volumes[0]!
    for (const vol of volumes) {
      if (vol.pct > busiest.pct) busiest = vol
    }

    return `${basename(busiest.path)} ${busiest.pct}%`
  })

  return { data, loading, error, refetch, chipStatus, chipMetric }
}
