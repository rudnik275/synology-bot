// The add-flow wizard step model (#177), extracted from AddFlow.vue.
//
// What it owns: the open/step/mode/handoff state, the drawn-step model
// (firstStep/lastStep/drawnSteps/canAdvance), navigation (goNext/goBack),
// open/reset, the pre-loaded handoff source (selectedFile/handoffUri) + the
// selected search result + destination + errorMsg, AND the deep-link handoff
// (startFromStashedTorrent, rebuilding bytes via lib/base64).
//
// What it does NOT own (injected or kept in AddFlow): the inspect→commit machine
// (useInspectCommit — passed in as resetInspect/cancelInspectIfOpen callbacks),
// the search execution + history, the FolderPicker, the optimistic insert + the
// commit composition in create(), and the Telegram BackButton (useTgBackButton).
//
// A lightweight composable, deliberately NOT the GoF State pattern — there are
// only three steps and two paths, so explicit step numbers + a `handoff` flag are
// clearer than a state-object hierarchy (ADR 0001).
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { SearchResultView } from '../types'
import { base64ToFile } from '../lib/base64'

// How the add source was supplied:
//   'search' — in-app Toloka search (the only in-app mode)
//   'file'   — a .torrent's bytes handed off by the bot (#99)
//   'uri'    — a magnet/URL handed off by the bot (#120)
export type Mode = 'search' | 'file' | 'uri'

/** What the wizard reads back from the bot's stash for the deep-link handoff. */
export type TorrentStash =
  | { kind: 'bytes'; name: string; base64: string }
  | { kind: 'uri'; uri: string }

/** Collaborators the wizard needs but does not own. Injected so the composable
 *  is testable in isolation (the inspect machine + api stay outside). */
export interface WizardDeps {
  /** Last-used folder, used to pre-seed the destination on open/handoff
   *  (null when nothing was used yet — useFolderShortcuts). */
  lastFolder: Ref<string | null>
  /** Fetch what the bot stashed for the deep-link handoff (api.torrentStash). */
  torrentStash: (token: string) => Promise<TorrentStash>
  /** Clear inspect/selection state (useInspectCommit.resetInspect). */
  resetInspect: () => void
  /** Best-effort release of an uncommitted inspect (useInspectCommit.cancelInspectIfOpen). */
  cancelInspectIfOpen: () => void
  /** Optional hook run inside resetForm(), for state the wizard does not own
   *  (AddFlow clears its search-mode refs here so reset has a single path). */
  onReset?: () => void
}

export interface UseAddWizard {
  // ─── State ───
  open: Ref<boolean>
  step: Ref<1 | 2 | 3>
  mode: Ref<Mode>
  handoff: Ref<boolean>
  selectedFile: Ref<File | null>
  handoffUri: Ref<string>
  destination: Ref<string>
  errorMsg: Ref<string | null>
  selectedResult: Ref<SearchResultView | null>

  // ─── Step model ───
  /** The first drawn step: 1 (Search) in-app, 2 (Folder) on the bot handoff. */
  firstStep: ComputedRef<1 | 2>
  /** The last drawn step (always 3 = Confirm for both paths). */
  lastStep: ComputedRef<number>
  /** Steps shown in the stepper — handoff hides Search (only Folder · Confirm). */
  drawnSteps: ComputedRef<number[]>
  /** Whether the current step has a valid value so Next can advance. */
  canAdvance: ComputedRef<boolean>

  // ─── Actions ───
  goNext: () => void
  goBack: () => void
  openSheet: () => void
  resetForm: () => void
  startFromStashedTorrent: (token: string) => Promise<void>
}

export function useAddWizard(deps: WizardDeps): UseAddWizard {
  const open = ref(false)
  // Steps are renumbered search-first:
  //   in-app:   1 Search · 2 Folder · 3 Confirm
  //   handoff:  (Search skipped) · 2 Folder · 3 Confirm — Search is not drawn.
  const step = ref<1 | 2 | 3>(1)
  const mode = ref<Mode>('search')
  // True for the bot-handoff path: source is pre-loaded, Search step is skipped.
  const handoff = ref(false)
  // Pre-loaded source for the handoff path: a reconstructed .torrent File OR a URI.
  const selectedFile = ref<File | null>(null)
  const handoffUri = ref('')
  // Destination path from FolderPicker.
  const destination = ref('')
  // Submission state (failures surface via errorMsg on the next open — #161).
  const errorMsg = ref<string | null>(null)
  // The chosen in-app search result (search mode).
  const selectedResult = ref<SearchResultView | null>(null)

  const firstStep = computed<1 | 2>(() => (handoff.value ? 2 : 1))
  const lastStep = computed<number>(() => 3)
  const drawnSteps = computed<number[]>(() => (handoff.value ? [2, 3] : [1, 2, 3]))

  const canAdvance = computed<boolean>(() => {
    if (step.value === 1) return selectedResult.value !== null // Search
    if (step.value === 2) return destination.value.trim().length > 0 // Folder
    return true // Confirm
  })

  function goNext(): void {
    if (!canAdvance.value) return
    if (step.value < 3) step.value = (step.value + 1) as 1 | 2 | 3
  }

  function goBack(): void {
    // On the handoff path the Folder step (2) is the first drawn step, so Back
    // from Confirm lands on Folder, and there is no Back on Folder itself.
    const floor = handoff.value ? 2 : 1
    // Leaving Confirm without committing → release the inspecting list on the NAS.
    if (step.value === 3) {
      deps.cancelInspectIfOpen()
      deps.resetInspect()
    }
    if (step.value > floor) step.value = (step.value - 1) as 1 | 2 | 3
  }

  function resetForm(): void {
    step.value = 1
    mode.value = 'search'
    handoff.value = false
    selectedFile.value = null
    handoffUri.value = ''
    destination.value = ''
    errorMsg.value = null
    selectedResult.value = null
    deps.resetInspect()
    deps.onReset?.()
  }

  function openSheet(): void {
    open.value = true
    resetForm()
    // Pre-populate destination from last-used folder so the confirm step shows it.
    // FolderPicker will also open into this folder via its own onMounted logic.
    if (deps.lastFolder.value) destination.value = deps.lastFolder.value
  }

  /**
   * Deep-link entry (#99, generalized #120): the bot stashed an add source and
   * opened the Mini App with a stash token. The stash holds either a .torrent's
   * bytes (`kind: 'bytes'`) or a magnet/URL string (`kind: 'uri'`). Either way the
   * wizard opens at the Folder step with the source pre-loaded; Search is skipped.
   * On failure fall back to the in-app search flow so the owner can recover.
   */
  async function startFromStashedTorrent(token: string): Promise<void> {
    open.value = true
    handoff.value = true
    if (deps.lastFolder.value) destination.value = deps.lastFolder.value
    try {
      const stash = await deps.torrentStash(token)
      if (stash.kind === 'uri') {
        mode.value = 'uri'
        handoffUri.value = stash.uri
      } else {
        mode.value = 'file'
        selectedFile.value = base64ToFile(stash.base64, stash.name)
      }
      step.value = 2 // Folder
    } catch (e) {
      // Recovery: drop back to the normal in-app search flow.
      handoff.value = false
      mode.value = 'search'
      errorMsg.value = e instanceof Error ? e.message : String(e)
      step.value = 1
    }
  }

  return {
    open,
    step,
    mode,
    handoff,
    selectedFile,
    handoffUri,
    destination,
    errorMsg,
    selectedResult,
    firstStep,
    lastStep,
    drawnSteps,
    canAdvance,
    goNext,
    goBack,
    openSheet,
    resetForm,
    startFromStashedTorrent,
  }
}
