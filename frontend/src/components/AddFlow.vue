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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Sheet from './ui/Sheet.vue'
import Button from './ui/Button.vue'
import FolderPicker from './FolderPicker.vue'
import StickerBadge from './ui/StickerBadge.vue'
import { api } from '../api'
import { torrentToken as deepLinkToken } from '../telegram'
import { usePrefersReducedMotion } from '../composables/usePrefersReducedMotion'
import { useFolderShortcuts } from '../composables/useFolderShortcuts'
import { useSearchHistory } from '../composables/useSearchHistory'
import { useOptimisticTasks } from '../composables/useOptimisticTasks'
import { useInspectCommit, type InspectSource } from '../composables/useInspectCommit'
import { formatBytes } from '../format'
import FileTree from './FileTree.vue'
import { buildFileTree, type FileTree as FileTreeModel, type InspectFile } from './fileTree'
import type { SearchResultView, CommitHandle } from '../types'

// How the add source was supplied:
//   'search' — in-app Toloka search (the only in-app mode)
//   'file'   — a .torrent's bytes handed off by the bot (#99)
//   'uri'    — a magnet/URL handed off by the bot (#120)
type Mode = 'search' | 'file' | 'uri'

// `deepLinkToken` injection seam: defaults to the token parsed from the Telegram
// start_param (#99); overridable so the auto-open path is testable without a
// global module mock.
const props = withDefaults(defineProps<{ torrentToken?: string }>(), {
  torrentToken: () => deepLinkToken,
})

const { prefersReducedMotion } = usePrefersReducedMotion()
const { lastFolder, recordRecent } = useFolderShortcuts()
const { history: searchHistory, recordQuery, clearHistory: clearSearchHistory } = useSearchHistory()
const optimistic = useOptimisticTasks()
const inspect = useInspectCommit(api)

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

// Destination path from FolderPicker
const destination = ref('')

// Submission state. The commit is fully optimistic (#161): «Добавить» closes the
// sheet instantly and the add runs in the background, so there is no in-sheet
// "submitting…" spinner — failures surface via errorMsg on the next open.
const errorMsg = ref<string | null>(null)

// Search mode state
const searchQuery = ref('')
const searchResults = ref<SearchResultView[]>([])
const searchLoading = ref(false)
const searchError = ref<string | null>(null)
const searchQueried = ref(false)
const selectedResult = ref<SearchResultView | null>(null)

// Search history dropdown
const searchHistoryVisible = ref(false)

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

// ─── Step model ────────────────────────────────────────────────

/** The first drawn step: 1 (Search) in-app, 2 (Folder) on the bot handoff. */
const firstStep = computed<1 | 2>(() => (handoff.value ? 2 : 1))

/** The last drawn step (always 3 = Confirm for both paths). */
const lastStep = computed<number>(() => 3)

/** Steps shown in the stepper — handoff hides Search (only Folder · Confirm). */
const drawnSteps = computed<number[]>(() => (handoff.value ? [2, 3] : [1, 2, 3]))

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

// ─── Navigation gating ────────────────────────────────────────────────

/** Whether the current step has a valid value so Next can advance. */
const canAdvance = computed<boolean>(() => {
  if (step.value === 1) return selectedResult.value !== null // Search (used internally by goNext)
  if (step.value === 2) return destination.value.trim().length > 0 // Folder
  return true // Confirm
})

/** Seed-health level for a seeder count. */
function seedHealth(seeders: number): 'green' | 'amber' | 'red' {
  if (seeders >= 20) return 'green'
  if (seeders >= 5) return 'amber'
  return 'red'
}

/** Select a search result and immediately advance to the Folder step (#121). */
function selectAndAdvance(result: SearchResultView): void {
  // Dismiss the on-screen keyboard before leaving the search step — tapping a
  // result advances to the folder step, but iOS otherwise keeps the keyboard up.
  ;(document.activeElement as HTMLElement | null)?.blur()
  selectedResult.value = result
  goNext()
}

// ─── Actions ────────────────────────────────────────────────

function openSheet(): void {
  open.value = true
  resetForm()
  // Pre-populate destination from last-used folder so the confirm step shows it.
  // FolderPicker will also open into this folder via its own onMounted logic.
  if (lastFolder.value) {
    destination.value = lastFolder.value
  }
}

function resetForm(): void {
  step.value = 1
  mode.value = 'search'
  handoff.value = false
  selectedFile.value = null
  handoffUri.value = ''
  destination.value = ''
  errorMsg.value = null
  searchQuery.value = ''
  searchResults.value = []
  searchLoading.value = false
  searchError.value = null
  searchQueried.value = false
  selectedResult.value = null
  resetInspect()
}

function goNext(): void {
  if (!canAdvance.value) return
  if (step.value < 3) step.value = (step.value + 1) as 1 | 2 | 3
}

/** Sheet close (X / dismiss): release any uncommitted inspect, then reset. */
function onClose(): void {
  cancelInspectIfOpen()
  resetForm()
}

function goBack(): void {
  // On the handoff path the Folder step (2) is the first drawn step, so Back
  // from Confirm lands on Folder, and there is no Back on Folder itself.
  const floor = handoff.value ? 2 : 1
  // Leaving Confirm without committing → release the inspecting list on the NAS.
  if (step.value === 3) {
    cancelInspectIfOpen()
    resetInspect()
  }
  if (step.value > floor) step.value = (step.value - 1) as 1 | 2 | 3
}

// --- Telegram BackButton wiring (#5) ---
// "Назад" between wizard steps is the native Telegram BackButton (the same
// affordance the Show-detail page uses, ADR 0009), not an in-sheet button. It
// shows whenever there is a previous step to return to; on the first drawn step
// the sheet's close (X) is the way out. Driven by a watcher so we never sprinkle
// show/hide calls across the navigation handlers.
function onTgBack(): void {
  goBack()
}
function showTgBackButton(): void {
  const btn = window.Telegram?.WebApp?.BackButton
  if (!btn) return
  btn.show()
  btn.onClick(onTgBack)
}
function hideTgBackButton(): void {
  const btn = window.Telegram?.WebApp?.BackButton
  if (!btn) return
  btn.hide()
  btn.offClick(onTgBack)
}
watch([open, step], ([isOpen, cur]) => {
  if (isOpen && cur > firstStep.value) showTgBackButton()
  else hideTgBackButton()
})
onUnmounted(hideTgBackButton)

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

/** Rebuild a File from the base64 payload the bot stashed (#99). */
function base64ToFile(base64: string, name: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'application/x-bittorrent' })
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
  if (lastFolder.value) destination.value = lastFolder.value
  try {
    const stash = await api.torrentStash(token)
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
        <div v-if="step === 1" class="step-input">
          <div class="field search-field">
            <label class="field-label" for="search-query">Поиск</label>
            <div class="search-row" style="position: relative;">
              <input
                id="search-query"
                v-model="searchQuery"
                type="text"
                class="field-input"
                placeholder="Введите название…"
                autocomplete="off"
                data-testid="search-query"
                @keydown.enter="runSearch"
                @focus="onSearchFocus"
                @blur="onSearchBlur"
              />
              <Button
                variant="ink"
                size="md"
                class="search-btn"
                data-testid="search-btn"
                :disabled="searchLoading"
                @click="runSearch"
              >
                {{ searchLoading ? '…' : 'Поиск' }}
              </Button>
              <!-- History dropdown -->
              <div
                v-if="searchHistoryVisible && (filteredHistory.length > 0 || searchHistory.length > 0)"
                class="search-history-dropdown"
                data-testid="search-history"
              >
                <div class="search-history-header">
                  <span class="search-history-label">Недавнее</span>
                  <button
                    type="button"
                    class="search-history-clear"
                    data-testid="search-history-clear"
                    @mousedown.prevent="onClearHistory"
                  >
                    Очистить
                  </button>
                </div>
                <ul class="search-history-list" role="listbox">
                  <li
                    v-for="item in filteredHistory"
                    :key="item"
                    class="search-history-item"
                    data-testid="history-item"
                    role="option"
                    @mousedown.prevent="selectHistoryItem(item)"
                  >
                    {{ item }}
                  </li>
                </ul>
              </div>
            </div>

            <!-- Loading -->
            <div v-if="searchLoading" class="search-loading" data-testid="search-loading">
              Загрузка…
            </div>

            <!-- Error -->
            <div v-else-if="searchError" class="search-error" role="alert" data-testid="search-error">
              {{ searchError }}
            </div>

            <!-- Empty results -->
            <div v-else-if="searchQueried && searchResults.length === 0" class="search-empty" data-testid="search-empty">
              Ничего не найдено
            </div>

            <!-- Results — grouped card with hairline dividers (Variant B, #121) -->
            <div v-else-if="searchResults.length > 0" class="search-results" role="list" data-testid="search-results">
              <button
                v-for="result in searchResults"
                :key="result.id"
                type="button"
                class="result-row nb-pressable"
                role="listitem"
                :data-testid="`result-${result.id}`"
                @click="selectAndAdvance(result)"
              >
                <div class="result-row-content">
                  <span class="result-title" data-testid="result-title">{{ result.title }}</span>
                  <span class="result-meta">
                    <span
                      v-if="result.quality && result.quality.length > 0"
                      class="result-chip"
                      data-testid="result-quality"
                    >{{ result.quality[0] }}</span>
                    <span class="result-health" :data-health="seedHealth(result.seeders)">
                      <span class="result-health-dot" :class="`result-health-dot--${seedHealth(result.seeders)}`" aria-hidden="true"></span>
                      <span data-testid="result-seeders">{{ result.seeders }}</span>
                    </span>
                    <span class="result-size" data-testid="result-size">{{ result.size }}</span>
                  </span>
                </div>
                <svg class="result-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- ── Step 2: Destination folder ── -->
        <!-- One label only (#2): FolderPicker owns its own «Куда сохранить»
             heading and shows the selected folder inline, so the step-label and
             the "Selected: …" preview were redundant and are gone. -->
        <div v-else-if="step === 2" class="step-folder">
          <FolderPicker v-model="destination" />
        </div>

        <!-- ── Step 3: Confirm — pudgy card (title + chips + folder) ── -->
        <div v-else-if="step === 3" class="step-confirm">
          <!-- THE one heavy container: title + chips + folder. -->
          <div class="bigcard" data-testid="confirm-card">
            <div class="bc-head">
              <h3 class="bc-title" data-testid="confirm-title">{{ confirmTitle }}</h3>
              <StickerBadge tone="violet" data-testid="confirm-sticker">К&nbsp;загрузке</StickerBadge>
            </div>

            <!-- Flat metadata chips (year / quality / source / languages, #117). -->
            <div v-if="confirmChips.length > 0" class="bc-chips" data-testid="confirm-chips">
              <span v-for="chip in confirmChips" :key="chip" class="chip">{{ chip }}</span>
            </div>

            <!-- Files section (#123): auto-inspect → file TREE → commit subset.
                 Header rule + tree, NO outer box (border diet). -->
            <div class="files">
              <div class="files-hd">
                <span class="files-t">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  Файлы<template v-if="inspectState === 'ready'"> · {{ inspectFiles.length }}</template>
                </span>
                <span v-if="inspectState === 'ready'" class="files-sz" data-testid="confirm-size">
                  {{ formatBytes(selectedSize) }}
                </span>
              </div>

              <!-- Inspecting: loading state while polling the inspect list. -->
              <div v-if="inspectState === 'inspecting'" class="files-loading" data-testid="inspect-loading">
                <span class="spinner" aria-hidden="true"></span>
                Читаю содержимое торрента…
              </div>

              <!-- Ready: the interactive tree with functional checkboxes. -->
              <FileTree
                v-else-if="inspectState === 'ready' && fileTree"
                :tree="fileTree"
                v-model:selected="selectedIndices"
              />

              <!-- Whole-torrent fallback (magnet / inspect unavailable or failed). -->
              <div v-else class="files-whole" data-testid="inspect-whole">
                <p class="files-whole-msg">
                  {{ inspectError
                    ? 'Не удалось прочитать список файлов — будет добавлен торрент целиком.'
                    : 'Для этого источника список файлов недоступен — торрент добавится целиком.' }}
                </p>
              </div>
            </div>

            <!-- Folder block (variant A): label + path + «Изменить» (no pin). -->
            <div class="dest">
              <div class="dest-info">
                <div class="dest-lab">Папка на NAS</div>
                <div class="dest-path" data-testid="confirm-destination">{{ destination }}</div>
              </div>
              <button type="button" class="dest-edit" data-testid="confirm-edit-folder" @click="goBack">
                Изменить
              </button>
            </div>
          </div>

          <!-- Error message -->
          <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
        </div>

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

/* ── Step label ── */
.step-label {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
}

/* ── Step 1: Search input ── */
.step-input {
  flex: 1;
}

.field {
  margin-bottom: var(--space-4);
}

.field-label {
  display: block;
  margin-bottom: var(--space-1);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field-input {
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  font-family: var(--font);
  font-size: var(--fs-md);
  color: var(--ink);
}
.field-input:focus {
  outline: none;
  box-shadow: var(--shadow-md);
}

/* Search */
.search-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.search-row {
  display: flex;
  gap: var(--space-2);
}

.search-row .field-input {
  flex: 1;
  min-height: 44px;
  resize: none;
}

/* Layout only — the recipe lives in the shared <Button variant="ink">. */
.search-btn {
  white-space: nowrap;
}

.search-loading,
.search-empty {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--fs-sm);
  opacity: 0.7;
}

.search-error {
  padding: var(--space-2) var(--space-3);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* Search history dropdown */
.search-history-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 48px; /* leave room for Search button */
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 100;
  overflow: hidden;
}

.search-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-3);
  border-bottom: var(--border);
}

.search-history-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
}

.search-history-clear {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  color: var(--ink);
}
.search-history-clear:hover {
  opacity: 1;
}

.search-history-list {
  list-style: none;
  margin: 0;
  padding: var(--space-1) 0;
}

.search-history-item {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-history-item:hover {
  background: var(--yellow);
}

/* ── Grouped results card (Variant B, #121) ── */

/* Outer container: single border, single shadow — the "one grouped card" */
.search-results {
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--paper);
  box-shadow: var(--shadow-sm);
}

/* Each row is a full-width button with a hairline divider beneath it */
.result-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px; /* touch target */
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(9, 9, 11, 0.12); /* --hairline */
  border-radius: 0;
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  color: var(--ink);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical),
    background var(--dur-fast) var(--ease-out);
}
.result-row:last-child {
  border-bottom: none;
}
.result-row:active {
  background: rgba(9, 9, 11, 0.04);
}

/* Content column: takes all remaining width */
.result-row-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Title: bold, single line, ellipsis */
.result-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Meta row: quality chip + seed health + size */
.result-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

/* Quality chip (resolution badge) */
.result-chip {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: var(--fw-bold);
  padding: 2px 7px;
  border: 2px solid var(--ink);
  border-radius: 999px;
  background: var(--paper);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Seed-health indicator: dot + count */
.result-health {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: var(--fw-bold);
  flex-shrink: 0;
}

.result-health-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--ink);
  flex-shrink: 0;
}
.result-health-dot--green  { background: var(--green); }
.result-health-dot--amber  { background: var(--orange); }
.result-health-dot--red    { background: var(--red); }

/* File size */
.result-size {
  font-size: 10px;
  font-weight: var(--fw-bold);
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Chevron affordance */
.result-chevron {
  width: 16px;
  height: 16px;
  opacity: 0.4;
  flex-shrink: 0;
}

/* ── Step 3: Folder ── */
.step-folder {
  flex: 1;
}

.destination-preview {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  opacity: 0.7;
}
.destination-preview code {
  font-family: monospace;
}

/* ── Step 3: Confirm — pudgy card + file tree (#123) ──
   Border diet: ONE loud frame (the card). Inside, hairline dividers + flat
   chips replace nested boxes. overflow:visible so the card's offset shadow
   isn't clipped against the footer. */
.step-confirm {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: visible;
}

.bigcard {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.bc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}

/* Title wraps FULLY — the confirm step shows the complete name, no truncation. */
.bc-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  line-height: 1.18;
  overflow-wrap: anywhere;
}

/* Chips: FLAT tags — no border, no shadow. */
.bc-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  font-size: 11px;
  font-weight: var(--fw-bold);
  padding: 5px 11px;
  border-radius: 999px;
  background: rgba(9, 9, 11, 0.06);
  color: rgba(9, 9, 11, 0.7);
}

/* Files block — NO outer box: header rule + tree directly in the card. */
.files {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.files-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 2px solid rgba(9, 9, 11, 0.13);
}
.files-t {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: var(--fw-bold);
  font-size: var(--fs-sm);
}
.files-t svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.files-sz {
  font-family: var(--mono, monospace);
  font-size: 12px;
  font-weight: var(--fw-bold);
  opacity: 0.6;
}

/* Inspecting / loading state. */
.files-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  font-size: var(--fs-sm);
  opacity: 0.75;
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(9, 9, 11, 0.2);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: addflow-spin 0.7s linear infinite;
}
@keyframes addflow-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}

/* Whole-torrent fallback message. */
.files-whole {
  padding: var(--space-3) 0;
}
.files-whole-msg {
  margin: 0;
  font-size: var(--fs-sm);
  opacity: 0.7;
}

/* Folder block (variant A): hairline above; only «Изменить» is bordered. */
.dest {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 2px solid rgba(9, 9, 11, 0.13);
}
.dest-info {
  min-width: 0;
}
.dest-lab {
  font-size: 10px;
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.45;
}
.dest-path {
  font-family: var(--mono, monospace);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dest-edit {
  flex: 0 0 auto;
  min-height: 44px;
  font-family: var(--font);
  font-size: 11px;
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  padding: 7px 14px;
  border: 2px solid var(--ink);
  border-radius: 999px;
  background: var(--yellow);
  color: var(--ink);
  cursor: pointer;
}

/* The «Добавить» CTA is coral on this step (commit = terminal add action). */
.footer-btn--coral {
  background: var(--coral);
}

.error-msg {
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
</style>
