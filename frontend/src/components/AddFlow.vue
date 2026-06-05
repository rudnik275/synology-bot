<script setup lang="ts">
// Add-flow wizard overlay — search-only Mini App intake (ADR 0008, #120).
//
// In-app path (FAB → fullscreen Sheet): Search → Folder → Confirm (3 steps).
// The source-chooser step, the magnet/URL input, and the in-wizard .torrent
// upload were removed; magnet/.torrent now arrive via the bot handoff below.
//
// Bot-handoff path (deep-link with a stash token): the bot stashed a .torrent's
// bytes (#99) or a magnet/URL (#120). The wizard opens directly at the Folder
// step with the source pre-loaded, then Confirm (2 steps; Search is not drawn).
//
// Mounted by App.vue alongside DownloadsTab. The manual open trigger has moved
// out of this component — DownloadsTab renders an inline «Добавить загрузку»
// row (#118) and calls openSheet() via the exposed method. The deep-link/handoff
// path (torrentToken / auto-open) is unchanged.
import { ref, computed, onMounted, watch } from 'vue'
import Sheet from './ui/Sheet.vue'
import Button from './ui/Button.vue'
import FolderPicker from './FolderPicker.vue'
import AddSearchStep from './AddSearchStep.vue'
import AddConfirmStep from './AddConfirmStep.vue'
import { api } from '../api'
import { torrentToken as deepLinkToken } from '../telegram'
import { usePrefersReducedMotion } from '../composables/usePrefersReducedMotion'
import { useFolderShortcuts } from '../composables/useFolderShortcuts'
import { useSearchHistory } from '../composables/useSearchHistory'
import { useOptimisticTasks } from '../composables/useOptimisticTasks'
import { useTgBackButton } from '../composables/useTgBackButton'
import { useAddWizard } from '../composables/useAddWizard'
import { useInspectCommit, type InspectSource } from '../composables/useInspectCommit'
import { buildFileTree, type FileTree as FileTreeModel, type InspectFile } from './fileTree'
import type { SearchResultView, CommitHandle } from '../types'

// `deepLinkToken` injection seam: defaults to the token parsed from the Telegram
// start_param (#99); overridable so the auto-open path is testable without a
// global module mock.
const props = withDefaults(defineProps<{ torrentToken?: string }>(), {
  torrentToken: () => deepLinkToken,
})

// `owns-back` tells the App shell when the wizard sheet owns the navigation
// surface. While the sheet is open, ALL back semantics belong to it (step→step
// via the native BackButton, or the sheet's close ✕ on the first step); the
// shell must NOT also pop its section→hub level on the same press (ADR 0015 nav
// coordination, S1 #222).
const emit = defineEmits<{ 'owns-back': [boolean] }>()

const { prefersReducedMotion } = usePrefersReducedMotion()
const { lastFolder, recordRecent } = useFolderShortcuts()
const { history: searchHistory, recordQuery, clearHistory: clearSearchHistory } = useSearchHistory()
const optimistic = useOptimisticTasks()
const inspect = useInspectCommit(api)

// ─── Confirm step: inspect → select → commit (#123) ──────────────────────────
// Reaching Confirm AUTO-inspects (DS2 create_list) and shows the torrent's file
// TREE so the owner can untick files; «Добавить» then commits only the ticked
// subset. Magnet sources (no local bytes to self-host) and inspect failures fall
// back to a whole-torrent add ('whole'), so the owner can always proceed. The
// whole inspect→commit state machine (stale-run guard, fast-tap chain) lives in
// the useInspectCommit composable (#171); this component drives it and owns the
// optimistic insert + the commit composition in create().
const {
  inspectState,
  commitHandle,
  inspectFiles,
  selectedIndices,
  inspectError,
  runInspect,
  resetInspect,
  cancelInspectIfOpen,
} = inspect

// ─── Wizard step model + mode + deep-link handoff (useAddWizard, #177) ────────
// The open/step/mode/handoff state, the drawn-step model, navigation, open/reset,
// the pre-loaded handoff source + selected result + destination + errorMsg, and
// the bot-handoff (startFromStashedTorrent) all live in the composable; AddFlow
// drives the inspect machine + search + commit around it.
const wizard = useAddWizard({
  lastFolder,
  torrentStash: api.torrentStash,
  resetInspect,
  cancelInspectIfOpen,
  // Search-mode refs live in AddFlow (not the wizard); clear them on every reset.
  onReset: () => resetSearchState(),
})
const {
  open,
  step,
  mode,
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
} = wizard

// Search mode state
const searchQuery = ref('')
const searchResults = ref<SearchResultView[]>([])
const searchLoading = ref(false)
const searchError = ref<string | null>(null)
const searchQueried = ref(false)

// Search history dropdown
const searchHistoryVisible = ref(false)

/** Clear the search-mode refs — runs from the wizard's resetForm (onReset hook).
 *  selectedResult is owned + cleared by the wizard. */
function resetSearchState(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchLoading.value = false
  searchError.value = null
  searchQueried.value = false
}

/** The built folder/file tree for the current inspect (null until ready). */
const fileTree = computed<FileTreeModel | null>(() =>
  inspectState.value === 'ready' && inspectFiles.value.length > 0
    ? buildFileTree(inspectFiles.value as InspectFile[])
    : null
)

/** Total size of the ticked files — drives the card's size readout. */
const selectedSize = computed<number>(() => {
  const sel = new Set(selectedIndices.value)
  return inspectFiles.value.reduce((sum, f) => (sel.has(f.index) ? sum + f.size : sum), 0)
})

/** Whether the source can be inspected for a per-file tree. Magnets (uri mode)
 *  have no local bytes to self-host → whole-torrent only. */
const canInspect = computed<boolean>(() => {
  if (mode.value === 'search') return selectedResult.value !== null
  if (mode.value === 'file') return selectedFile.value !== null
  return false
})

// ─── Confirm step metadata ─────────────────────────────────────────────────

/** Clean metadata for the confirm card header (#117 fields off the result). */
const confirmTitle = computed<string>(() => {
  if (mode.value === 'search' && selectedResult.value) return selectedResult.value.title
  if (mode.value === 'file' && selectedFile.value) return selectedFile.value.name
  if (mode.value === 'uri') return handoffUri.value
  return ''
})

const confirmChips = computed<string[]>(() => {
  const r = selectedResult.value
  if (mode.value !== 'search' || !r) return []
  const chips: string[] = []
  if (r.year) chips.push(String(r.year))
  if (r.quality) chips.push(...r.quality)
  if (r.languages && r.languages.length > 0) chips.push(r.languages.join('/'))
  return chips
})

const filteredHistory = computed<string[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return searchHistory.value
  return searchHistory.value.filter((item) => item.toLowerCase().includes(q))
})

// ─── Stepper UI (derived from the wizard's drawn-step model) ──────────────────

/** Russian labels for each step by step number. */
const STEP_LABELS: Record<number, string> = {
  1: 'Поиск',
  2: 'Папка',
  3: 'Готово',
}

/** Stepper items for the UI: 1-indexed display position, label, state. */
const stepperItems = computed(() =>
  drawnSteps.value.map((stepNum, index) => ({
    stepNum,
    displayNum: index + 1,
    label: STEP_LABELS[stepNum],
    state: stepNum < step.value ? 'done' : stepNum === step.value ? 'current' : 'future',
  }))
)

/** Select a search result and immediately advance to the Folder step (#121). */
function selectAndAdvance(result: SearchResultView): void {
  // Dismiss the on-screen keyboard before leaving the search step — tapping a
  // result advances to the folder step, but iOS otherwise keeps the keyboard up.
  ;(document.activeElement as HTMLElement | null)?.blur()
  selectedResult.value = result
  goNext()
}

/** Sheet close (X / dismiss): release any uncommitted inspect, then reset. */
function onClose(): void {
  cancelInspectIfOpen()
  resetForm()
}

// --- Telegram BackButton wiring (#5) ---
// "Назад" between wizard steps is the native Telegram BackButton (the same
// affordance the Show-detail page uses, ADR 0009), not an in-sheet button. It
// shows whenever there is a previous step to return to; on the first drawn step
// the sheet's close (X) is the way out. Driven by a watcher so we never sprinkle
// show/hide calls across the navigation handlers. The SDK wiring + unmount
// cleanup live in useTgBackButton (#177; shared with ShowsTab).
const { show: showTgBackButton, hide: hideTgBackButton } = useTgBackButton(goBack)
watch([open, step], ([isOpen, cur]) => {
  if (isOpen && cur > firstStep.value) showTgBackButton()
  else hideTgBackButton()
})

// Mirror sheet-open state to the shell (see the `owns-back` emit above). Emitted
// for every open/close so the shell can re-enable its section→hub back the
// instant the wizard closes.
watch(open, (isOpen) => emit('owns-back', isOpen))

// --- Inspect-on-Confirm (#123) ---
// The inspect→commit state machine lives in useInspectCommit (#171). This
// component only decides WHAT to inspect (the current source) and WHEN (entering
// Confirm); the composable owns the stale-run guard + fast-tap chain.

/** The source for an inspect, derived from the current add mode. Magnets/URIs
 *  (uri mode) have no local bytes to self-host → null (whole-torrent only). */
function currentInspectSource(): InspectSource {
  if (!canInspect.value) return null
  if (mode.value === 'file' && selectedFile.value) {
    return { kind: 'file', file: selectedFile.value, destination: destination.value }
  }
  if (mode.value === 'search' && selectedResult.value) {
    return { kind: 'search', url: selectedResult.value.downloadUrl, title: selectedResult.value.title, destination: destination.value }
  }
  return null
}

// Auto-inspect when the Confirm step is entered (both in-app and handoff paths).
// runInspect tracks its own in-flight promise so a fast-tap «Добавить» can chain
// its commit after it (#161).
watch(step, (now, prev) => {
  if (now === 3 && prev !== 3) {
    void runInspect(currentInspectSource())
  }
})

async function runSearch(): Promise<void> {
  // Dismiss the on-screen keyboard on the explicit search commit (Enter, the
  // «Поиск» button, or a recent-search chip — all funnel through here). iOS
  // otherwise keeps the keyboard up over the results. (#159)
  ;(document.activeElement as HTMLElement | null)?.blur()
  const q = searchQuery.value.trim()
  if (!q) return
  searchLoading.value = true
  searchError.value = null
  searchQueried.value = false
  searchResults.value = []
  selectedResult.value = null
  try {
    searchResults.value = await api.search(q)
    searchQueried.value = true
    recordQuery(q)
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : String(e)
  } finally {
    searchLoading.value = false
  }
}

function onSearchFocus(): void {
  searchHistoryVisible.value = true
}

function onSearchBlur(): void {
  searchHistoryVisible.value = false
}

function selectHistoryItem(item: string): void {
  searchQuery.value = item
  searchHistoryVisible.value = false
  runSearch()
}

function onClearHistory(): void {
  clearSearchHistory()
}

// Deep-link entry (#99/#120): the bot stashed an add source and opened the Mini
// App with a stash token; startFromStashedTorrent (useAddWizard) opens at the
// Folder step with the source pre-loaded, falling back to search on failure.
onMounted(() => {
  if (props.torrentToken) void startFromStashedTorrent(props.torrentToken)
})

// Expose openSheet so DownloadsTab (or any parent) can trigger the wizard
// from the inline «Добавить загрузку» row (#118).
defineExpose({ openSheet })

function create(): void {
  errorMsg.value = null

  // Capture EVERYTHING the add needs into locals NOW, before resetForm() (below)
  // clears the refs — `doAdd` must be fully self-contained so it can run AFTER we
  // close the sheet (fully-optimistic commit, #161). `dest` is captured here too
  // because resetForm() nulls destination.
  const dest = destination.value
  const title = confirmTitle.value

  // Build the add call. If the torrent was inspected, COMMIT the chosen files;
  // otherwise (inspect failed/timed out, magnet, or no tree) add the whole torrent
  // via the documented create — a .torrent upload (file) or a uri (magnet /
  // search / handoff URL).
  let doAdd: () => Promise<unknown>
  let committedHandle: CommitHandle | null = null
  if (inspectState.value === 'ready' && commitHandle.value) {
    if (selectedIndices.value.length === 0) {
      errorMsg.value = 'Выберите хотя бы один файл.'
      return
    }
    const handle = commitHandle.value
    const indices = [...selectedIndices.value]
    committedHandle = handle
    doAdd = () => api.commitTask(handle, indices, dest)
  } else if (inspectState.value === 'inspecting' && canInspect.value && inspect.inFlight()) {
    // Fast-tap: the owner hit «Добавить» before inspect resolved. Don't make them
    // wait — CHAIN the commit on the in-flight inspect promise in the background.
    // The placeholder shows immediately; the commit fires the moment inspect
    // settles. The outcome (commit handle + indices, or whole-torrent fallback)
    // comes from the promise's RESOLVED VALUE, not the component refs — resetForm()
    // clears those the instant the sheet closes below. protectInflight() stops the
    // imminent resetForm() from invalidating the run we're awaiting.
    const pending = inspect.inFlight()!
    inspect.protectInflight()
    // Capture the whole-torrent fallback source NOW (refs are about to be cleared).
    const fallback = captureWholeTorrentAdd(dest)
    doAdd = async () => {
      try {
        const outcome = await pending
        if (outcome.kind === 'ready' && outcome.indices.length > 0) {
          return await api.commitTask(outcome.handle, outcome.indices, dest)
        }
        return await fallback()
      } finally {
        inspect.releaseInflight() // the run's list is now consumed (or never existed)
      }
    }
  } else if (mode.value === 'file') {
    if (!selectedFile.value) {
      errorMsg.value = 'No .torrent file loaded.'
      return
    }
    const file = selectedFile.value
    doAdd = () => api.createTaskFromFile(file, dest)
  } else if (mode.value === 'uri') {
    const uri = handoffUri.value.trim()
    if (!uri) {
      errorMsg.value = 'No magnet link or URL loaded.'
      return
    }
    doAdd = () => api.createTask(uri, dest)
  } else {
    if (!selectedResult.value) {
      errorMsg.value = 'Please select a search result.'
      return
    }
    const url = selectedResult.value.downloadUrl
    doAdd = () => api.createTask(url, dest)
  }

  // Optimistic insert: drop a pending placeholder into the Downloads list now so
  // the download appears the instant the sheet closes (the poll is every 3 s and
  // DSM takes a few seconds to register). useTasks retires it when the real task
  // arrives; rolled back in doAdd's .catch if the add fails.
  const optimisticId = optimistic.add({ title, destination: dest })
  if (dest) recordRecent(dest)

  // The commit handle is consumed by doAdd — null it BEFORE resetForm so resetForm's
  // abandon path doesn't fire a redundant delete for the list we're committing.
  // (The fast-tap branch nulls it inside doAdd, once it has the handle.)
  if (committedHandle) inspect.clearHandle()

  // Close the sheet + reset INSTANTLY (synchronously) — the placeholder is already
  // showing in the list — then fire the add in the BACKGROUND without awaiting, so
  // the sheet never blocks on DSM (#161). A failed add rolls back the placeholder.
  open.value = false
  resetForm()
  void doAdd().catch((e) => {
    optimistic.remove(optimisticId)
    // The sheet is gone, so surface failures on the next open via errorMsg.
    errorMsg.value = e instanceof Error ? e.message : String(e)
  })
}

/**
 * Capture a whole-torrent fallback add as a self-contained closure, snapshotting
 * the source from the CURRENT refs (file / uri / search URL) + the given `dest`.
 * Used by the fast-tap chain so the fallback survives resetForm() clearing refs.
 */
function captureWholeTorrentAdd(dest: string): () => Promise<unknown> {
  if (mode.value === 'file' && selectedFile.value) {
    const file = selectedFile.value
    return () => api.createTaskFromFile(file, dest)
  }
  if (mode.value === 'uri' && handoffUri.value.trim()) {
    const uri = handoffUri.value.trim()
    return () => api.createTask(uri, dest)
  }
  if (mode.value === 'search' && selectedResult.value) {
    const url = selectedResult.value.downloadUrl
    return () => api.createTask(url, dest)
  }
  return () => Promise.reject(new Error('No add source available.'))
}
</script>

<template>
  <!-- Fullscreen Add Wizard (opened by inline row in DownloadsTab, #118) -->
  <Sheet v-model:open="open" title="Добавить" variant="fullscreen" @close="onClose">
    <!-- Step content — wrapped in Transition unless reduced motion -->
    <div class="wizard-body">
      <component :is="'div'" :class="['wizard-step', { 'wizard-step--animated': !prefersReducedMotion }]">

        <!-- ── Step 1: Search (in-app primary entry; skipped on bot handoff) ── -->
        <AddSearchStep
          v-if="step === 1"
          v-model:search-query="searchQuery"
          :search-loading="searchLoading"
          :search-error="searchError"
          :search-queried="searchQueried"
          :search-results="searchResults"
          :search-history-visible="searchHistoryVisible"
          :filtered-history="filteredHistory"
          :search-history="searchHistory"
          @search="runSearch"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          @clear-history="onClearHistory"
          @select-history="selectHistoryItem"
          @select-result="selectAndAdvance"
        />

        <!-- ── Step 2: Destination folder ── -->
        <!-- One label only (#2): FolderPicker owns its own «Куда сохранить»
             heading and shows the selected folder inline, so the step-label and
             the "Selected: …" preview were redundant and are gone. -->
        <div v-else-if="step === 2" class="step-folder">
          <FolderPicker v-model="destination" />
        </div>

        <!-- ── Step 3: Confirm — pudgy card (title + chips + folder) ── -->
        <AddConfirmStep
          v-else-if="step === 3"
          v-model:selected="selectedIndices"
          :confirm-title="confirmTitle"
          :confirm-chips="confirmChips"
          :inspect-state="inspectState"
          :inspect-files="inspectFiles"
          :file-tree="fileTree"
          :selected-size="selectedSize"
          :inspect-error="inspectError"
          :destination="destination"
          :error-msg="errorMsg"
          @go-back="goBack"
        />

      </component>
    </div>

    <!-- Sticky footer with Back / Next / Add -->
    <div class="wizard-footer">
      <!-- Step indicator — numbered stepper (Variant B, #119) — own full-width row
           ABOVE the actions so its circles+labels never collide with the buttons. -->
      <div class="stepper" aria-hidden="true" data-testid="stepper">
        <template v-for="(item, index) in stepperItems" :key="item.stepNum">
          <div class="stepper-node">
            <div
              class="stepper-circle"
              :class="{
                'stepper-circle--done': item.state === 'done',
                'stepper-circle--current': item.state === 'current',
              }"
            >
              <span v-if="item.state === 'done'" class="stepper-check">✓</span>
              <span v-else>{{ item.displayNum }}</span>
            </div>
            <span
              class="stepper-label"
              :class="{ 'stepper-label--current': item.state === 'current' }"
            >{{ item.label }}</span>
          </div>
          <div
            v-if="index < stepperItems.length - 1"
            class="stepper-line"
            :class="{ 'stepper-line--future': item.state === 'future' }"
          ></div>
        </template>
      </div>

      <!-- Actions row: a single primary CTA (#5). "Назад" is the native Telegram
           BackButton, not an in-sheet button, so there is no back/next pair to
           balance. Step 1 (Search) has no forward button — tapping a result
           advances. Step 2 → «Далее», step 3 → «Добавить». -->
      <div v-if="step !== 1" class="footer-actions">
        <Button
          v-if="step < lastStep"
          variant="primary"
          size="lg"
          class="footer-btn footer-btn--full"
          data-testid="wizard-next"
          :disabled="!canAdvance"
          @click="goNext"
        >
          Далее →
        </Button>
        <Button
          v-else
          variant="primary"
          size="lg"
          class="footer-btn footer-btn--full footer-btn--coral"
          data-testid="create-btn"
          :disabled="inspectState === 'ready' && selectedIndices.length === 0"
          @click="create"
        >
          Добавить
        </Button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
/* ── Wizard layout ── */
.wizard-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* Side + bottom padding = room for offset shadows inside the scroll/clip box
     (overflow-y:auto forces overflow-x:auto, which would otherwise clip the
     bottom-right shadows and add a phantom horizontal scrollbar). The gutter
     lives here now (Sheet drops its side padding for the fullscreen variant). */
  padding-left: var(--space-4);
  padding-right: var(--space-4);
  padding-bottom: var(--space-3);
}

.wizard-step {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.wizard-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: var(--border);
  margin-top: var(--space-3);
  flex-shrink: 0;
  /* Bottom room so the actions' 5px offset shadow isn't clipped by the
     sheet-body's overflow:hidden; env() stacks the device safe-area on top. */
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-2));
  padding-left: var(--space-4);
  padding-right: var(--space-4);
}

.footer-actions {
  display: flex;
  align-items: center;
}

/* Single full-width primary CTA (#5) — no back/next pair to balance anymore. */
.footer-btn--full {
  width: 100%;
}

/* ── Numbered stepper (#119, Variant B) ── */
.stepper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  min-width: 0;
}

.stepper-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.stepper-circle {
  width: 28px;
  height: 28px;
  border: var(--border-strong);
  border-radius: 50%;
  background: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--fw-bold);
  font-size: var(--fs-sm);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.stepper-circle--done {
  background: var(--ink);
  color: var(--paper);
}

.stepper-circle--current {
  background: var(--yellow);
}

.stepper-check {
  font-size: var(--fs-md);
  line-height: 1;
}

.stepper-label {
  font-size: 10px;
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.45;
  white-space: nowrap;
}

.stepper-label--current {
  opacity: 1;
}

.stepper-line {
  flex: 1;
  height: 4px;
  background: var(--ink);
  border-radius: 2px;
  /* Vertically centre on the 28px circle (14px − 2px half-line). */
  margin-top: 12px;
  min-width: 12px;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.stepper-line--future {
  opacity: 0.22;
}

/* ── Step 2: Folder ── */
.step-folder {
  flex: 1;
}

/* The «Добавить» CTA is coral on the Confirm step (commit = terminal add action). */
.footer-btn--coral {
  background: var(--coral);
}
</style>
