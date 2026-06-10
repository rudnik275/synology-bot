<script setup lang="ts">
// Add-flow Step 3: Confirm — the pudgy card (#177, extracted from AddFlow.vue).
//
// Reaching Confirm AUTO-inspects (#123): this step renders the title + metadata
// chips, the inspect file TREE (or the inspecting loader / whole-torrent fallback
// message), the size readout, and the destination block. The inspect→commit state
// machine (useInspectCommit) and the commit composition stay in AddFlow; this is
// presentation only — it surfaces the selected-file set via v-model:selected and
// emits `goBack` for the «Изменить» button. DOM (testids, classes) is verbatim so
// the AddFlow integration net holds.
import Chip from './ui/Chip.vue'
import LoadingText from './ui/LoadingText.vue'
import StickerBadge from './ui/StickerBadge.vue'
import FileTree from './FileTree.vue'
import { formatBytes } from '../format'
import type { FileTree as FileTreeModel, InspectFile } from './fileTree'
import type { InspectState } from '../composables/useInspectCommit'
import type { InspectFileView } from '../types'

defineProps<{
  confirmTitle: string
  confirmChips: string[]
  inspectState: InspectState
  inspectFiles: InspectFileView[]
  fileTree: FileTreeModel | null
  selectedSize: number
  inspectError: string | null
  /** Progress hint while a magnet poll waits on peer metadata (#304). */
  inspectHint: string | null
  /** True when the magnet poll timed out (no peers) — the 'whole' fallback then
   *  reads as a metadata timeout, not an inspect failure (#304). */
  inspectTimedOut: boolean
  destination: string
  errorMsg: string | null
}>()

const selectedIndices = defineModel<number[]>('selected', { required: true })

const emit = defineEmits<{ goBack: [] }>()
</script>

<template>
  <div class="step-confirm">
    <!-- THE one heavy container: title + chips + folder. -->
    <div class="bigcard" data-testid="confirm-card">
      <div class="bc-head">
        <h3 class="bc-title" data-testid="confirm-title">{{ confirmTitle }}</h3>
        <StickerBadge tone="violet" data-testid="confirm-sticker">К&nbsp;загрузке</StickerBadge>
      </div>

      <!-- Flat metadata chips (year / quality / source / languages, #117). -->
      <div v-if="confirmChips.length > 0" class="bc-chips" data-testid="confirm-chips">
        <Chip v-for="chip in confirmChips" :key="chip" variant="flat">{{ chip }}</Chip>
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
        <template v-if="inspectState === 'inspecting'">
          <LoadingText
            label="Читаю содержимое торрента…"
            :size="16"
            class="files-loading"
            data-testid="inspect-loading"
          />
          <!-- Magnet poll taking long → DSM is waiting on peers for the metadata (#304). -->
          <p v-if="inspectHint" class="files-hint" data-testid="inspect-hint">{{ inspectHint }}</p>
        </template>

        <!-- Ready: the interactive tree with functional checkboxes. -->
        <FileTree
          v-else-if="inspectState === 'ready' && fileTree"
          :tree="fileTree"
          :files="(inspectFiles as InspectFile[])"
          v-model:selected="selectedIndices"
        />

        <!-- Whole-torrent fallback: metadata timeout (#304) / inspect failed / unavailable. -->
        <div v-else class="files-whole" data-testid="inspect-whole">
          <p class="files-whole-msg">
            {{ inspectTimedOut
              ? 'Метаданные недоступны — торрент будет добавлен целиком.'
              : inspectError
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
        <button type="button" class="dest-edit" data-testid="confirm-edit-folder" @click="emit('goBack')">
          Изменить
        </button>
      </div>
    </div>

    <!-- Error message -->
    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
  </div>
</template>

<style scoped>
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
  border-bottom: 2px solid var(--hairline-strong-color);
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
  padding: var(--space-4) 0;
}

/* Peer-wait hint under the inspecting loader (#304). */
.files-hint {
  margin: 0;
  padding-bottom: var(--space-3);
  font-size: var(--fs-sm);
  opacity: 0.7;
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
  border-top: 2px solid var(--hairline-strong-color);
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
  border-radius: var(--radius-pill);
  background: var(--yellow);
  color: var(--ink);
  cursor: pointer;
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
