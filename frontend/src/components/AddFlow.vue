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
import { ref, computed, onMounted } from 'vue'
import Sheet from './Sheet.vue'
import Button from './Button.vue'
import FolderPicker from './FolderPicker.vue'
import { api } from '../api'
import { torrentToken as deepLinkToken } from '../telegram'
import { usePrefersReducedMotion } from '../composables/usePrefersReducedMotion'
import { useFolderShortcuts } from '../composables/useFolderShortcuts'
import { useSearchHistory } from '../composables/useSearchHistory'
import type { SearchResultView } from '../types'

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

// Submission state
const submitting = ref(false)
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

const filteredHistory = computed<string[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return searchHistory.value
  return searchHistory.value.filter((item) => item.toLowerCase().includes(q))
})

// ─── Step model ────────────────────────────────────────────────

/** Human label for the pre-loaded handoff source, shown on Confirm. */
const handoffSourceLabel = computed<string>(() =>
  mode.value === 'file' ? '.torrent File' : 'Magnet / URL'
)

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
}

function goNext(): void {
  if (!canAdvance.value) return
  if (step.value < 3) step.value = (step.value + 1) as 1 | 2 | 3
}

function goBack(): void {
  // On the handoff path the Folder step (2) is the first drawn step, so Back
  // from Confirm lands on Folder, and there is no Back on Folder itself.
  const floor = handoff.value ? 2 : 1
  if (step.value > floor) step.value = (step.value - 1) as 1 | 2 | 3
}

async function runSearch(): Promise<void> {
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

async function create(): Promise<void> {
  errorMsg.value = null

  submitting.value = true
  try {
    if (mode.value === 'file') {
      if (!selectedFile.value) {
        errorMsg.value = 'No .torrent file loaded.'
        return
      }
      await api.createTaskFromFile(selectedFile.value, destination.value)
    } else if (mode.value === 'uri') {
      if (!handoffUri.value.trim()) {
        errorMsg.value = 'No magnet link or URL loaded.'
        return
      }
      await api.createTask(handoffUri.value.trim(), destination.value)
    } else {
      if (!selectedResult.value) {
        errorMsg.value = 'Please select a search result.'
        return
      }
      await api.createTask(selectedResult.value.downloadUrl, destination.value)
    }
    // Success: record the destination as a recent BEFORE resetForm clears it.
    if (destination.value) recordRecent(destination.value)
    // Close the sheet; the Downloads list refreshes on its own poll.
    open.value = false
    resetForm()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- Fullscreen Add Wizard (opened by inline row in DownloadsTab, #118) -->
  <Sheet v-model:open="open" title="Добавить" variant="fullscreen" @close="resetForm">
    <!-- Step content — wrapped in Transition unless reduced motion -->
    <div class="wizard-body">
      <component :is="'div'" :class="['wizard-step', { 'wizard-step--animated': !prefersReducedMotion }]">

        <!-- ── Step 1: Search (in-app primary entry; skipped on bot handoff) ── -->
        <div v-if="step === 1" class="step-input">
          <div class="field search-field">
            <label class="field-label" for="search-query">Search</label>
            <div class="search-row" style="position: relative;">
              <input
                id="search-query"
                v-model="searchQuery"
                type="text"
                class="field-input"
                placeholder="Enter title…"
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
                {{ searchLoading ? '…' : 'Search' }}
              </Button>
              <!-- History dropdown -->
              <div
                v-if="searchHistoryVisible && (filteredHistory.length > 0 || searchHistory.length > 0)"
                class="search-history-dropdown"
                data-testid="search-history"
              >
                <div class="search-history-header">
                  <span class="search-history-label">Recent</span>
                  <button
                    type="button"
                    class="search-history-clear"
                    data-testid="search-history-clear"
                    @mousedown.prevent="onClearHistory"
                  >
                    Clear
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
              Loading…
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
        <div v-else-if="step === 2" class="step-folder">
          <p class="step-label">Destination folder</p>
          <FolderPicker v-model="destination" />
          <p v-if="destination" class="destination-preview">
            Selected: <code>{{ destination }}</code>
          </p>
        </div>

        <!-- ── Step 3: Confirm ── -->
        <div v-else-if="step === 3" class="step-confirm">
          <p class="step-label">Confirm</p>
          <div class="confirm-summary">
            <div class="confirm-row">
              <span class="confirm-key">Source</span>
              <span class="confirm-val">{{ mode === 'search' ? 'Search' : handoffSourceLabel }}</span>
            </div>
            <div v-if="mode === 'search' && selectedResult" class="confirm-row">
              <span class="confirm-key">Title</span>
              <span class="confirm-val">{{ selectedResult.title }}</span>
            </div>
            <div v-else-if="mode === 'uri'" class="confirm-row">
              <span class="confirm-key">Link</span>
              <span class="confirm-val confirm-val--mono">{{ handoffUri }}</span>
            </div>
            <div v-else-if="mode === 'file' && selectedFile" class="confirm-row">
              <span class="confirm-key">File</span>
              <span class="confirm-val">{{ selectedFile.name }}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-key">Destination</span>
              <span class="confirm-val confirm-val--mono">{{ destination }}</span>
            </div>
          </div>

          <!-- Error message -->
          <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
        </div>

      </component>
    </div>

    <!-- Sticky footer with Back / Next / Add -->
    <div class="wizard-footer">
      <!-- Back — not shown on the first drawn step (step 1 in-app, step 2 on handoff) -->
      <Button
        v-if="step > firstStep"
        variant="neutral"
        size="lg"
        class="footer-btn"
        data-testid="wizard-back"
        @click="goBack"
      >
        ← Назад
      </Button>
      <span v-else class="footer-spacer" aria-hidden="true"></span>

      <!-- Step indicator — numbered stepper, path-aware (Variant B, #119). -->
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

      <!-- Next (not last step, not search step — search advances via tap-to-select) / Добавить (last step) -->
      <Button
        v-if="step > 1 && step < lastStep"
        variant="primary"
        size="lg"
        class="footer-btn"
        data-testid="wizard-next"
        :disabled="!canAdvance"
        @click="goNext"
      >
        Далее →
      </Button>
      <!-- On the search step there is no Next button; a spacer keeps the footer balanced. -->
      <span v-else-if="step === 1" class="footer-spacer" aria-hidden="true"></span>
      <Button
        v-else
        variant="primary"
        size="lg"
        class="footer-btn"
        data-testid="create-btn"
        :disabled="submitting"
        @click="create"
      >
        {{ submitting ? 'Добавление…' : 'Добавить' }}
      </Button>
    </div>
  </Sheet>
</template>

<style scoped>
/* ── Wizard layout ── */
.wizard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.wizard-step {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: var(--border);
  margin-top: var(--space-4);
  flex-shrink: 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.footer-spacer {
  width: 80px;
  flex-shrink: 0;
}

/* Layout only — Back/Next/Add are the shared <Button>; this just balances the
   footer width against the 80px spacer on the opposite side. */
.footer-btn {
  min-width: 80px;
}

/* ── Numbered stepper (#119, Variant B) ── */
.stepper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.stepper-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.stepper-circle {
  width: 36px;
  height: 36px;
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
  margin-top: 16px;
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

/* ── Step 4: Confirm ── */
.step-confirm {
  flex: 1;
}

.confirm-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.confirm-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.confirm-key {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
}

.confirm-val {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
}

.confirm-val--mono {
  font-family: monospace;
  font-size: var(--fs-sm);
  word-break: break-all;
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
