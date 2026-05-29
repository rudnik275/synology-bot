<script setup lang="ts">
// Add-flow wizard overlay (#95): FAB → fullscreen Sheet → 4-step wizard.
// Step 1: Choose source (Search default, Magnet, Torrent)
// Step 2: Source-specific input
// Step 3: FolderPicker (destination)
// Step 4: Confirm summary + Add button
// Mounted by App.vue as a fixed overlay on the Downloads surface.
import { ref, computed } from 'vue'
import Sheet from './Sheet.vue'
import FAB from './FAB.vue'
import FolderPicker from './FolderPicker.vue'
import { api } from '../api'
import { usePrefersReducedMotion } from '../composables/usePrefersReducedMotion'
import type { SearchResultView } from '../types'

type Mode = 'magnet' | 'torrent' | 'search'

const { prefersReducedMotion } = usePrefersReducedMotion()

const open = ref(false)
const step = ref<1 | 2 | 3 | 4>(1)
const mode = ref<Mode>('search')

// Magnet/URL input
const magnetUri = ref('')

// .torrent file
const selectedFile = ref<File | null>(null)

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

// ─── Navigation gating ────────────────────────────────────────────────

/** Whether the current step has a valid value so Next can advance. */
const canAdvance = computed<boolean>(() => {
  if (step.value === 1) return true
  if (step.value === 2) {
    if (mode.value === 'magnet') return magnetUri.value.trim().length > 0
    if (mode.value === 'torrent') return selectedFile.value !== null
    if (mode.value === 'search') return selectedResult.value !== null
  }
  if (step.value === 3) return destination.value.trim().length > 0
  return true
})

// ─── Actions ────────────────────────────────────────────────

function openSheet(): void {
  open.value = true
  resetForm()
}

function resetForm(): void {
  step.value = 1
  mode.value = 'search'
  magnetUri.value = ''
  selectedFile.value = null
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
  if (step.value < 4) step.value = (step.value + 1) as 1 | 2 | 3 | 4
}

function goBack(): void {
  if (step.value > 1) step.value = (step.value - 1) as 1 | 2 | 3 | 4
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
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : String(e)
  } finally {
    searchLoading.value = false
  }
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
}

async function create(): Promise<void> {
  errorMsg.value = null

  submitting.value = true
  try {
    if (mode.value === 'torrent') {
      if (!selectedFile.value) {
        errorMsg.value = 'Please select a .torrent file.'
        return
      }
      await api.createTaskFromFile(selectedFile.value, destination.value)
    } else if (mode.value === 'search') {
      if (!selectedResult.value) {
        errorMsg.value = 'Please select a search result.'
        return
      }
      await api.createTask(selectedResult.value.downloadUrl, destination.value)
    } else {
      if (!magnetUri.value.trim()) {
        errorMsg.value = 'Please enter a magnet link or URL.'
        return
      }
      await api.createTask(magnetUri.value.trim(), destination.value)
    }
    // Success: close the sheet; the Downloads list refreshes on its own poll.
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
  <!-- FAB: fixed bottom-right, floats above tab content -->
  <FAB label="Add download" @click="openSheet" />

  <!-- Fullscreen Add Wizard -->
  <Sheet v-model:open="open" title="Add Download" variant="fullscreen" @close="resetForm">
    <!-- Step content — wrapped in Transition unless reduced motion -->
    <div class="wizard-body">
      <component :is="'div'" :class="['wizard-step', { 'wizard-step--animated': !prefersReducedMotion }]">

        <!-- ── Step 1: Choose source ── -->
        <div v-if="step === 1" class="step-source">
          <p class="step-label">Choose source</p>
          <div class="source-cards" role="group" aria-label="Add source">
            <button
              type="button"
              class="source-card"
              :class="{ 'source-card--selected': mode === 'search' }"
              :aria-pressed="mode === 'search'"
              data-testid="mode-search"
              @click="mode = 'search'"
            >
              <span class="source-icon">🔍</span>
              <span class="source-name">Search</span>
              <span class="source-desc">Find by title</span>
            </button>
            <button
              type="button"
              class="source-card"
              :class="{ 'source-card--selected': mode === 'magnet' }"
              :aria-pressed="mode === 'magnet'"
              data-testid="mode-magnet"
              @click="mode = 'magnet'"
            >
              <span class="source-icon">🔗</span>
              <span class="source-name">Magnet / URL</span>
              <span class="source-desc">Paste a magnet link or URL</span>
            </button>
            <button
              type="button"
              class="source-card"
              :class="{ 'source-card--selected': mode === 'torrent' }"
              :aria-pressed="mode === 'torrent'"
              data-testid="mode-torrent"
              @click="mode = 'torrent'"
            >
              <span class="source-icon">📄</span>
              <span class="source-name">.torrent File</span>
              <span class="source-desc">Upload a .torrent file</span>
            </button>
          </div>
        </div>

        <!-- ── Step 2: Input ── -->
        <div v-else-if="step === 2" class="step-input">
          <!-- Magnet -->
          <div v-if="mode === 'magnet'" class="field">
            <label class="field-label" for="magnet-uri">Magnet link or URL</label>
            <textarea
              id="magnet-uri"
              v-model="magnetUri"
              class="field-input field-textarea"
              placeholder="magnet:?xt=…"
              rows="4"
              autocomplete="off"
              spellcheck="false"
              data-testid="magnet-input"
            />
          </div>

          <!-- .torrent file -->
          <div v-else-if="mode === 'torrent'" class="field">
            <label class="field-label" for="torrent-file">.torrent file</label>
            <label class="file-upload-label" for="torrent-file">
              <span class="file-upload-icon">📄</span>
              <span class="file-upload-text">
                {{ selectedFile ? selectedFile.name : 'Tap to select a .torrent file' }}
              </span>
              <input
                id="torrent-file"
                type="file"
                accept=".torrent"
                class="file-upload-native"
                data-testid="torrent-input"
                @change="onFileChange"
              />
            </label>
          </div>

          <!-- Search -->
          <div v-else-if="mode === 'search'" class="field search-field">
            <label class="field-label" for="search-query">Search</label>
            <div class="search-row">
              <input
                id="search-query"
                v-model="searchQuery"
                type="text"
                class="field-input"
                placeholder="Enter title…"
                autocomplete="off"
                data-testid="search-query"
                @keydown.enter="runSearch"
              />
              <button
                type="button"
                class="search-btn"
                data-testid="search-btn"
                :disabled="searchLoading"
                @click="runSearch"
              >
                {{ searchLoading ? '…' : 'Search' }}
              </button>
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

            <!-- Results -->
            <ul v-else-if="searchResults.length > 0" class="search-results" role="list" data-testid="search-results">
              <li
                v-for="result in searchResults"
                :key="result.id"
              >
                <button
                  type="button"
                  class="result-card"
                  :class="{ 'result-card--selected': selectedResult?.id === result.id }"
                  :data-testid="`result-${result.id}`"
                  @click="selectedResult = result"
                >
                  <span class="result-title" data-testid="result-title">{{ result.title }}</span>
                  <span class="result-meta">
                    <span data-testid="result-size">{{ result.size }}</span>
                    <span class="result-sep">·</span>
                    <span>S: <span data-testid="result-seeders">{{ result.seeders }}</span></span>
                    <span class="result-sep">·</span>
                    <span>L: <span data-testid="result-leechers">{{ result.leechers }}</span></span>
                    <span class="result-sep">·</span>
                    <span data-testid="result-category">{{ result.category }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <!-- ── Step 3: Destination folder ── -->
        <div v-else-if="step === 3" class="step-folder">
          <p class="step-label">Destination folder</p>
          <FolderPicker v-model="destination" />
          <p v-if="destination" class="destination-preview">
            Selected: <code>{{ destination }}</code>
          </p>
        </div>

        <!-- ── Step 4: Confirm ── -->
        <div v-else-if="step === 4" class="step-confirm">
          <p class="step-label">Confirm</p>
          <div class="confirm-summary">
            <div class="confirm-row">
              <span class="confirm-key">Source</span>
              <span class="confirm-val">{{ mode === 'search' ? 'Search' : mode === 'magnet' ? 'Magnet / URL' : '.torrent File' }}</span>
            </div>
            <div v-if="mode === 'search' && selectedResult" class="confirm-row">
              <span class="confirm-key">Title</span>
              <span class="confirm-val">{{ selectedResult.title }}</span>
            </div>
            <div v-else-if="mode === 'magnet'" class="confirm-row">
              <span class="confirm-key">Link</span>
              <span class="confirm-val confirm-val--mono">{{ magnetUri }}</span>
            </div>
            <div v-else-if="mode === 'torrent' && selectedFile" class="confirm-row">
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
      <!-- Back -->
      <button
        v-if="step > 1"
        type="button"
        class="footer-btn footer-btn--back"
        data-testid="wizard-back"
        @click="goBack"
      >
        Back
      </button>
      <span v-else class="footer-spacer" aria-hidden="true"></span>

      <!-- Step indicator -->
      <div class="step-dots" aria-hidden="true">
        <span
          v-for="n in 4"
          :key="n"
          class="step-dot"
          :class="{ 'step-dot--active': n === step }"
        ></span>
      </div>

      <!-- Next (steps 1-3) / Add (step 4) -->
      <button
        v-if="step < 4"
        type="button"
        class="footer-btn footer-btn--next"
        data-testid="wizard-next"
        :disabled="!canAdvance"
        @click="goNext"
      >
        Next
      </button>
      <button
        v-else
        type="button"
        class="footer-btn footer-btn--add"
        data-testid="create-btn"
        :disabled="submitting"
        @click="create"
      >
        {{ submitting ? 'Adding…' : 'Add' }}
      </button>
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

.footer-btn {
  min-height: 48px;
  min-width: 80px;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.footer-btn--back {
  background: var(--cream);
  border: var(--border);
  box-shadow: var(--shadow-sm);
  color: var(--ink);
}
.footer-btn--back:active:not(:disabled) {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}

.footer-btn--next,
.footer-btn--add {
  background: var(--yellow);
  border: var(--border-strong);
  box-shadow: var(--shadow-md);
  color: var(--ink);
}
.footer-btn--next:active:not(:disabled),
.footer-btn--add:active:not(:disabled) {
  transform: translate(5px, 5px);
  box-shadow: var(--shadow-none);
}

/* Step dots */
.step-dots {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}
.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink);
  opacity: 0.2;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.step-dot--active {
  opacity: 1;
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

/* ── Step 1: Source cards ── */
.step-source {
  flex: 1;
}

.source-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.source-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 64px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical),
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.source-card:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.source-card--selected {
  background: var(--yellow);
  border-color: var(--ink);
  border-width: var(--border-thick);
  box-shadow: var(--shadow-md);
}

.source-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.source-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  flex: 1;
}

.source-desc {
  font-size: var(--fs-sm);
  opacity: 0.6;
}

/* ── Step 2: Input ── */
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

.field-input,
.field-textarea {
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
  resize: vertical;
}
.field-textarea {
  resize: vertical;
  line-height: 1.5;
}
.field-input:focus,
.field-textarea:focus {
  outline: none;
  box-shadow: var(--shadow-md);
}

/* Styled file upload — hides native input, shows custom label */
.file-upload-label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 64px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-md);
  color: var(--ink);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.file-upload-label:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.file-upload-native {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.file-upload-icon {
  font-size: 24px;
  flex-shrink: 0;
}
.file-upload-text {
  flex: 1;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  word-break: break-all;
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

.search-btn {
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--ink);
  color: var(--cream);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.search-btn:active:not(:disabled) {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.result-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.result-card:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.result-card--selected {
  border-color: var(--ink);
  border-width: var(--border-thick);
  background: var(--yellow);
  box-shadow: var(--shadow-md);
}

.result-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.3;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  font-size: var(--fs-xs);
  opacity: 0.7;
}

.result-sep {
  opacity: 0.4;
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
