<script setup lang="ts">
// Add-flow overlay (#63): FAB → Sheet → mode switcher → FolderPicker → create.
// Mounted by App.vue as a fixed overlay on the Downloads surface.
// Owned entirely by this slice; #61 owns the Downloads list.
import { ref } from 'vue'
import Sheet from './Sheet.vue'
import FAB from './FAB.vue'
import FolderPicker from './FolderPicker.vue'
import { api } from '../api'

type Mode = 'magnet' | 'torrent' | 'search'

const open = ref(false)
const mode = ref<Mode>('magnet')

// Magnet/URL input
const magnetUri = ref('')

// .torrent file
const selectedFile = ref<File | null>(null)

// Destination path from FolderPicker
const destination = ref('')

// Submission state
const submitting = ref(false)
const errorMsg = ref<string | null>(null)

function openSheet(): void {
  open.value = true
  resetForm()
}

function resetForm(): void {
  mode.value = 'magnet'
  magnetUri.value = ''
  selectedFile.value = null
  destination.value = ''
  errorMsg.value = null
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
}

async function create(): Promise<void> {
  errorMsg.value = null

  // Client-side guard
  if (!destination.value.trim()) {
    errorMsg.value = 'Please select a destination folder.'
    return
  }

  submitting.value = true
  try {
    if (mode.value === 'torrent') {
      if (!selectedFile.value) {
        errorMsg.value = 'Please select a .torrent file.'
        return
      }
      await api.createTaskFromFile(selectedFile.value, destination.value)
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

  <!-- Add Sheet -->
  <Sheet v-model:open="open" title="Add Download">
    <!-- Mode switcher -->
    <div class="mode-switcher" role="group" aria-label="Add mode">
      <button
        type="button"
        class="mode-btn"
        :class="{ active: mode === 'magnet' }"
        data-testid="mode-magnet"
        @click="mode = 'magnet'"
      >
        Magnet / URL
      </button>
      <button
        type="button"
        class="mode-btn"
        :class="{ active: mode === 'torrent' }"
        data-testid="mode-torrent"
        @click="mode = 'torrent'"
      >
        .torrent
      </button>
      <button
        type="button"
        class="mode-btn mode-btn--soon"
        data-testid="mode-search"
        disabled
        aria-label="Search — coming soon"
      >
        Search <span class="soon-label">soon</span>
      </button>
    </div>

    <!-- Magnet / URL mode -->
    <div v-if="mode === 'magnet'" class="field">
      <label class="field-label" for="magnet-uri">Magnet link or URL</label>
      <textarea
        id="magnet-uri"
        v-model="magnetUri"
        class="field-input field-textarea"
        placeholder="magnet:?xt=…"
        rows="3"
        autocomplete="off"
        spellcheck="false"
        data-testid="magnet-input"
      />
    </div>

    <!-- .torrent mode -->
    <div v-if="mode === 'torrent'" class="field">
      <label class="field-label" for="torrent-file">.torrent file</label>
      <input
        id="torrent-file"
        type="file"
        accept=".torrent"
        class="field-file"
        data-testid="torrent-input"
        @change="onFileChange"
      />
    </div>

    <!-- Destination picker -->
    <div class="field">
      <p class="field-label">Destination folder</p>
      <FolderPicker v-model="destination" />
      <p v-if="destination" class="destination-preview">
        Selected: <code>{{ destination }}</code>
      </p>
    </div>

    <!-- Error message -->
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <!-- Create button -->
    <button
      type="button"
      class="create-btn"
      data-testid="create-btn"
      :disabled="submitting"
      @click="create"
    >
      {{ submitting ? 'Adding…' : 'Add' }}
    </button>
  </Sheet>
</template>

<style scoped>
.mode-switcher {
  display: flex;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  border: var(--border);
  border-radius: var(--radius);
  padding: var(--space-1);
  background: var(--cream);
}

.mode-btn {
  flex: 1;
  min-height: 44px;
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: 2px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.mode-btn.active {
  background: var(--ink);
  color: var(--cream);
  border-color: var(--ink);
}
.mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.mode-btn--soon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
}
.soon-label {
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 4px;
  border: 1px solid currentColor;
  border-radius: 2px;
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

.field-file {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
}

.destination-preview {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  opacity: 0.7;
}
.destination-preview code {
  font-family: monospace;
}

.error-msg {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.create-btn {
  display: block;
  width: 100%;
  min-height: 56px;
  padding: var(--space-3);
  background: var(--yellow);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.create-btn:active:not(:disabled) {
  transform: translate(5px, 5px);
  box-shadow: var(--shadow-none);
}
.create-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
