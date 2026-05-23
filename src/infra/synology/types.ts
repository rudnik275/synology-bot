export interface SynoEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: number
  }
}

export interface SynoAuthData {
  sid: string
}

export interface SynologyConfig {
  host: string
  user: string
  password: string
}

export type ReachabilityResult = { ok: true } | { ok: false; reason: string }

// ─── Health types ────────────────────────────────────────────────────────────

export interface SystemUtilization {
  cpu: {
    user_load: number
    system_load: number
  }
  memory: {
    real_usage: number
    total_real: number
    available_real: number
  }
}

export interface VolumeInfo {
  id: string
  name: string
  size: {
    total: string
    used: string
    free: string
  }
  status: 'normal' | 'crashed' | 'degraded' | string
}

export interface StorageInfo {
  volumes: VolumeInfo[]
}

export interface DiskEntry {
  id: string
  model: string
  temp: number
  status: 'normal' | 'warning' | 'crashed' | string
  smart_status: 'normal' | 'failed' | 'warning' | string
}

export interface DiskInfo {
  disks: DiskEntry[]
}
