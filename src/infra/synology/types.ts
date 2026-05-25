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

// --- Health types ---

export interface SystemUtilization {
  cpu: {
    user_load: number
    system_load: number
  }
  memory: {
    real_usage: number
    /** Total physical memory in KB. */
    total_real: number
    /** Available (unused) physical memory in KB. Note: DSM returns `avail_real`, not `available_real`. */
    avail_real: number
  }
}

export interface VolumeInfo {
  id: string
  /** Mount path, e.g. `/volume1`. DSM `load_info` doesn't return a separate `name` field. */
  vol_path: string
  size: {
    total: string
    used: string
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
  /** Synology's own temperature classifier — preferred over numeric temp for alerting.
   *  Synthesised by the client from the numeric `temp` since `load_info` doesn't return
   *  this field directly. */
  temperature_status: 'normal' | 'warning' | 'critical'
  status: 'normal' | 'warning' | 'crashed' | string
  smart_status: 'normal' | 'failed' | 'warning' | string
}

export interface DiskInfo {
  disks: DiskEntry[]
}

/** Raw response of SYNO.Storage.CGI.Storage `load_info` — both volumes and disks come in one call. */
export interface SynoStorageLoadInfo {
  volumes?: VolumeInfo[]
  disks?: Array<Omit<DiskEntry, 'temperature_status'>>
}

// --- Download / FileStation types ---

export interface SharedFolder {
  name: string
  path: string
}

export interface FolderEntry {
  name: string
  path: string
  isdir: boolean
}

// --- DownloadStation Task types ---

export type TaskStatus =
  | 'waiting'
  | 'downloading'
  | 'paused'
  | 'finishing'
  | 'finished'
  | 'hash_checking'
  | 'seeding'
  | 'filehosting_waiting'
  | 'extracting'
  | 'error'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  size: number
  additional?: {
    detail?: {
      destination?: string
      uri?: string
    }
    transfer?: {
      size_downloaded?: number
      speed_download?: number
    }
  }
}

export interface SynoTaskListData {
  tasks: Task[]
  total: number
  offset: number
}

export interface SynoDownloadTaskCreateData {
  list_id: string[]
}
