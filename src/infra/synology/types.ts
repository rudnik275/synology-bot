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
