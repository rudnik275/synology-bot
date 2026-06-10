// The add-flow inspect→commit state machine (#123, #161, #171), extracted from
// AddFlow.vue so the deep module — the stale-run sequence guard + the fast-tap
// chained-commit lifecycle — lives behind a small, stable interface.
//
// What it owns: running an inspect for a source (instant-tree token path OR the
// magnet poll path), the file tree + per-file selection it produces, the
// in-flight-promise bookkeeping for the fast-tap chain, and the best-effort
// release of an uncommitted magnet list. What it does NOT own (stays in
// AddFlow.vue): the optimistic insert, the sheet/step lifecycle, source modes
// (file / uri / search), the folder picker, the Telegram BackButton.
//
// The commit itself is built in AddFlow.create() because it composes with the
// optimistic insert and the whole-torrent fallback that live there; this
// composable exposes everything create() needs (the state it reads, the
// in-flight promise + protect/clear hooks for the fast-tap chain) WITHOUT
// create() reaching into private internals.
import { ref, type Ref } from 'vue'
import type { CommitHandle, InspectFileView, InspectStarted } from '../types'
import { allIndices, type InspectFile } from '../components/fileTree'

// Reaching Confirm AUTO-inspects (DS2 create_list) and shows the torrent's file
// TREE so the owner can untick files. Magnet sources (no local bytes to
// self-host) and inspect failures fall back to a whole-torrent add ('whole'), so
// the owner can always proceed.
export type InspectState = 'idle' | 'inspecting' | 'ready' | 'whole'

// The result an inspect run settled to. A fast «Добавить» tap chains its commit
// on this (rather than reading the component refs, which resetForm() clears the
// instant the sheet closes) so the owner never waits for inspect to finish — #161.
//   'ready' → commit handle + indices; 'whole' → whole-torrent fallback.
export type InspectOutcome =
  | { kind: 'ready'; handle: CommitHandle; indices: number[] }
  | { kind: 'whole' }

// What the inspect run needs from the current source. Magnet/URI handoffs have
// no local bytes to inspect → pass `null` (canInspect is false in AddFlow) and
// the run resolves straight to 'whole'.
export type InspectSource =
  | { kind: 'file'; file: File; destination: string }
  | { kind: 'search'; url: string; title: string; destination: string }
  | null

/** The narrow API surface the inspect→commit machine depends on (src/api.ts's
 *  `api` satisfies it; tests stub just these four). */
export interface InspectApi {
  inspect: (uri: string, destination: string, title?: string) => Promise<InspectStarted>
  inspectFile: (file: File, destination: string) => Promise<InspectStarted>
  pollInspect: (listId: string) => Promise<{ ready: boolean; files: { index: number; name: string; size: number }[] }>
  deleteInspect: (listId: string) => Promise<unknown>
}

/** Magnet-poll tuning knobs (#304). Production uses the defaults; tests inject
 *  tiny delays so the timeout path doesn't take ~30 s of wall-clock time. */
export interface InspectPollOptions {
  /** Max poll attempts before the whole-torrent timeout fallback (default 30). */
  pollAttempts?: number
  /** Delay between poll attempts in ms (default 1000). */
  pollIntervalMs?: number
  /** After how many not-ready polls the peer-wait hint shows (default 3). */
  hintAfterAttempts?: number
}

/** Shown while a magnet poll is taking long — DSM is waiting on peers (#304). */
export const INSPECT_PEER_WAIT_HINT = '⏳ Ожидание метаданных от пиров…'

export interface UseInspectCommit {
  // ─── Reactive state (read by AddFlow's template + create()) ───
  inspectState: Ref<InspectState>
  /** The handle used to commit the current inspect (token or listId), or null. */
  commitHandle: Ref<CommitHandle | null>
  inspectFiles: Ref<InspectFileView[]>
  selectedIndices: Ref<number[]>
  inspectError: Ref<string | null>
  /** Progress hint while a magnet poll is waiting on peer metadata (#304). */
  inspectHint: Ref<string | null>
  /** True when the magnet poll exhausted its attempts without metadata — the
   *  'whole' fallback is a TIMEOUT, not an inspect failure (#304). */
  inspectTimedOut: Ref<boolean>

  // ─── Actions ───
  /** Inspect `source` (tracking the run as in-flight), settling to ready (tree
   *  shown) or whole (fallback). Returns the settled outcome. */
  runInspect: (source: InspectSource) => Promise<InspectOutcome>
  /** Clear inspect/selection state (reset / leaving Confirm). */
  resetInspect: () => void
  /** Best-effort release of an uncommitted inspect (magnet listId path only). */
  cancelInspectIfOpen: () => void

  // ─── Fast-tap lifecycle (for AddFlow.create()'s chained commit, #161) ───
  /** The in-flight runInspect() promise, or null when none is running. */
  inFlight: () => Promise<InspectOutcome> | null
  /** Protect the in-flight run from the imminent resetForm() so a fast-tap commit
   *  can await it (its seq guard would otherwise bail and delete the list). */
  protectInflight: () => void
  /** Release the fast-tap protection and drop the consumed commit handle. */
  releaseInflight: () => void
  /** Null the commit handle once create() has consumed it (pre-resetForm). */
  clearHandle: () => void
}

export function useInspectCommit(api: InspectApi, options: InspectPollOptions = {}): UseInspectCommit {
  const pollAttempts = options.pollAttempts ?? 30
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const hintAfterAttempts = options.hintAfterAttempts ?? 3

  // The handle used to commit the current inspect: a deferred `inspectToken`
  // (instant tree — no DSM list exists yet) or a pre-created `listId` (magnet poll
  // path). Only the listId path has a NAS list to release on cancel.
  const commitHandle = ref<CommitHandle | null>(null)
  const inspectState = ref<InspectState>('idle')
  const inspectFiles = ref<InspectFileView[]>([])
  const selectedIndices = ref<number[]>([])
  const inspectError = ref<string | null>(null)
  const inspectHint = ref<string | null>(null)
  const inspectTimedOut = ref(false)

  // Private: drop a stale poll that resolves after reset / re-open.
  let inspectSeq = 0
  // Private: the in-flight runInspect() promise, captured so a fast-tap «Добавить»
  // can chain its commit after it (#161).
  let inspectInFlight: Promise<InspectOutcome> | null = null
  // Private: set true when a fast-tap commit has been chained on the in-flight
  // inspect — the immediate resetForm() must then NOT invalidate that run (its seq
  // guard would otherwise bail and delete the very list we're committing). Cleared
  // once the run settles. The next inspect (re-open) starts fresh, so it can't leak.
  let protectInflightInspect = false
  // Private: the seq the active fast-tap protection belongs to (#294). A stale
  // releaseInflight (the protected chain settling AFTER the wizard was reopened
  // and a NEW inspect set a new commitHandle) must NOT clobber the new session's
  // handle — release is only honoured while the protected seq is still current.
  let protectedSeq: number | null = null

  // The core run, tracked as in-flight so a fast-tap can chain on it. A sequence
  // guard drops any poll that resolves after reset/close/re-open.
  async function doRun(source: InspectSource): Promise<InspectOutcome> {
    if (!source) {
      inspectState.value = 'whole'
      return { kind: 'whole' }
    }
    const seq = ++inspectSeq
    // A new run starts a NEW session: any prior fast-tap protection belongs to a
    // run this bump just made stale, so it must not suppress THIS session's
    // reset/stale guards (and its stale release must not clobber our handle, #294).
    protectInflightInspect = false
    protectedSeq = null
    inspectState.value = 'inspecting'
    inspectError.value = null
    inspectHint.value = null
    inspectTimedOut.value = false
    try {
      const started: InspectStarted =
        source.kind === 'file'
          ? await api.inspectFile(source.file, source.destination)
          : await api.inspect(source.url, source.destination, source.title)
      if (seq !== inspectSeq) {
        // Stale run (reset / re-open while in flight). Only the magnet path created a
        // NAS list to release; the instant-tree token path created nothing.
        if ('listId' in started) void api.deleteInspect(started.listId)
        return { kind: 'whole' }
      }
      if ('inspectToken' in started) {
        // Instant tree (#161 + deferred create): for sources we held the .torrent bytes
        // for, the server parsed the file tree (local bencode) and returned it with an
        // `inspectToken` — NO DSM list yet. We render NOW and skip the poll; the list is
        // created when the (optimistic) commit fires.
        const handle: CommitHandle = { inspectToken: started.inspectToken }
        commitHandle.value = handle
        const files = started.files.map((f) => ({ index: f.index, path: f.name, size: f.size }))
        inspectFiles.value = files
        const indices = allIndices(files as InspectFile[])
        selectedIndices.value = indices // all ticked by default
        inspectState.value = 'ready'
        return { kind: 'ready', handle, indices }
      }
      // Magnet (no local bytes): the list already exists; poll it until DSM parses
      // the metadata, then commit by listId.
      const handle: CommitHandle = { listId: started.listId }
      commitHandle.value = handle // set so a Back/cancel can release this list
      let files: InspectFileView[] = []
      let sawReady = false
      for (let i = 0; i < pollAttempts && seq === inspectSeq; i++) {
        const poll = await api.pollInspect(started.listId)
        if (seq !== inspectSeq) return { kind: 'whole' }
        if (poll.ready) {
          sawReady = true
          files = poll.files.map((f) => ({ index: f.index, path: f.name, size: f.size }))
          break
        }
        // After a few seconds DSM is clearly waiting on PEERS for the metadata —
        // tell the owner what the wait is about instead of a silent spinner (#304).
        if (i + 1 >= hintAfterAttempts) inspectHint.value = INSPECT_PEER_WAIT_HINT
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
      if (seq !== inspectSeq) return { kind: 'whole' }
      inspectHint.value = null
      // Exhausted the attempts without metadata → a TIMEOUT fallback, distinct
      // from an inspect failure (inspectError) and from "parsed zero files".
      if (!sawReady) inspectTimedOut.value = true
      inspectFiles.value = files
      const indices = allIndices(files as InspectFile[])
      selectedIndices.value = indices // all ticked by default
      inspectState.value = files.length > 0 ? 'ready' : 'whole'
      return files.length > 0 ? { kind: 'ready', handle, indices } : { kind: 'whole' }
    } catch (e) {
      inspectError.value = e instanceof Error ? e.message : String(e)
      inspectHint.value = null
      inspectState.value = 'whole'
      return { kind: 'whole' }
    }
  }

  function runInspect(source: InspectSource): Promise<InspectOutcome> {
    inspectInFlight = doRun(source).finally(() => { inspectInFlight = null })
    return inspectInFlight
  }

  /** Clear inspect/selection state (reset / leaving Confirm). */
  function resetInspect(): void {
    // When a fast-tap commit is chained on the in-flight inspect, DON'T bump the seq
    // — that run must finish and hand its handle to the pending commit. We only clear
    // the visible refs (the sheet is closing anyway); the run owns its own lifecycle.
    if (!protectInflightInspect) inspectSeq++
    inspectState.value = 'idle'
    inspectFiles.value = []
    selectedIndices.value = []
    inspectError.value = null
    inspectHint.value = null
    inspectTimedOut.value = false
    if (!protectInflightInspect) commitHandle.value = null
  }

  /** Best-effort release of an uncommitted inspect so no orphan lingers on the NAS.
   *  Only the magnet/listId path has a NAS list; the instant-tree token path created
   *  none (the list is born at commit), so cancelling it is a pure no-op. */
  function cancelInspectIfOpen(): void {
    inspectSeq++
    const handle = commitHandle.value
    if (handle && 'listId' in handle && inspectState.value !== 'whole') void api.deleteInspect(handle.listId)
    commitHandle.value = null
  }

  return {
    inspectState,
    commitHandle,
    inspectFiles,
    selectedIndices,
    inspectError,
    inspectHint,
    inspectTimedOut,
    runInspect,
    resetInspect,
    cancelInspectIfOpen,
    inFlight: () => inspectInFlight,
    protectInflight: () => {
      protectInflightInspect = true
      protectedSeq = inspectSeq // session token: release only honoured while current (#294)
    },
    releaseInflight: () => {
      // Session-scoped (#294): a NEWER inspect has started since this protect
      // (re-open fast path) → this release is STALE; nulling commitHandle now
      // would silently discard the new session's per-file selection. No-op.
      if (protectedSeq !== inspectSeq) return
      protectInflightInspect = false
      protectedSeq = null
      commitHandle.value = null // the run's list is now consumed (or never existed)
    },
    clearHandle: () => { commitHandle.value = null },
  }
}
