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
    /**
     * Percent of memory in use, computed by DSM the same way `free -m` does
     * (total minus available, where available accounts for reclaimable
     * cache/buffers). This is the only number you should trust for "is the
     * NAS under memory pressure?".
     */
    real_usage: number
    /** Total physical memory in KB. */
    total_real: number
    /**
     * Free memory in KB — currently not used by anything, including not as
     * cache. DSM names this `avail_real`, but it is NOT Linux's
     * `MemAvailable` (which counts reclaimable cache). Don't compute "used"
     * as `total - avail_real`; that includes cache and massively
     * over-reports usage. Use `real_usage` to derive used bytes.
     */
    avail_real: number
  }
}

/**
 * One process slice from `SYNO.Core.System.ProcessGroup/list` — DSM groups
 * related processes by systemd slice (`USBCopy.slice`, `plex.slice`, …) so
 * we get user-meaningful labels instead of raw command names.
 *
 * `cpu_utilization` is fraction-of-percent (e.g. `0.034` ≈ 0.034 % CPU);
 * `memory` is RSS in **bytes** summed across processes in the slice. Note
 * that the sibling `SYNO.Core.System.Process` API uses **KB** instead;
 * the two APIs share field names but not units.
 */
export interface ProcessGroupSlice {
  name: string
  unit_name: string
  cpu_utilization: number
  memory: number
}

export interface ProcessGroupList {
  slices: ProcessGroupSlice[]
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

// --- DownloadStation2 selective-download (two-phase create → select → commit) ---
//
// Verified on the live NAS (DSM 7, 2026-06-01). Selective per-file BT download
// is inspect → select → commit:
//   1. SYNO.DownloadStation2.Task `create` with create_list=true → list_id (INSPECTING)
//   2. SYNO.DownloadStation2.Task.List `get` (list_id) → file list (paths + sizes);
//      poll SYNO.DownloadStation2.Task.List.Polling while magnet/torrent metadata resolves
//   3. SYNO.DownloadStation2.Task.BT.File → set the wanted subset
//   4. SYNO.DownloadStation2.Task.Complete → commit; only selected files download
//   5. SYNO.DownloadStation2.Task.List `delete` (list_id) → cancel an uncommitted inspect
//
// ⚠ The exact WRITE payload shapes for BT.File and Complete were NOT exercised
// against a real write during the read-only probe — see the client method docs
// and the PR caveat. The API surface / versions / sequence ARE confirmed.

/**
 * One file inside an inspecting BT task list, as returned by
 * `SYNO.DownloadStation2.Task.List` `get`. DSM is loose about field names
 * across versions (the path may be `name` or `path`; `size` may be a number or
 * a numeric string), so the client normalises into {@link TaskListFile}.
 * `index` is the stable per-file index used to select the subset via `BT.File`.
 */
export interface SynoTaskListFile {
  index?: number
  name?: string
  path?: string
  size?: number | string
}

/** Raw `SYNO.DownloadStation2.Task.List` `get` payload (file list by list_id). */
export interface SynoTaskListGetData {
  files?: SynoTaskListFile[]
  /**
   * Whether DSM has finished resolving metadata for this list. Magnets resolve
   * server-side asynchronously, so the first `get` may return an empty file
   * list with `inspecting:true`; callers poll until it flips to false.
   */
  inspecting?: boolean
}

/** Normalized file entry surfaced to the server/contract (epic #58). */
export interface TaskListFile {
  /** Stable per-file index used to select the subset via BT.File. */
  index: number
  /** File path within the torrent (may contain `/` for nested folders). */
  path: string
  /** Size in bytes (0 when not yet known). */
  size: number
}

/** Result of an inspect (`create` with create_list=true → `Task.List get`). */
export interface TaskInspectResult {
  /** The list id of the inspecting task — passed back to commit or cancel. */
  listId: string
  /** Files discovered in the torrent/magnet. Empty while metadata still resolves. */
  files: TaskListFile[]
}
