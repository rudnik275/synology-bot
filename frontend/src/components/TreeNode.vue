<script setup lang="ts">
// One row of the confirm-step file tree (#123) — recursive. A folder row
// collapses on tap and owns a checkbox that toggles its whole subtree; a file
// row shows the bold label + dim raw name + size, with a functional checkbox
// that adds/removes that file's index from the BT.File subset.
import { ref, computed } from 'vue'
import type { TreeNode } from './fileTree'
import { formatBytes } from '../format'
import Checkbox from './ui/Checkbox.vue'

const props = defineProps<{
  node: TreeNode
  selectedSet: Set<number>
  depth: number
}>()

const emit = defineEmits<{ set: [indices: number[], on: boolean] }>()

const collapsed = ref(false)

const fileChecked = computed(() =>
  props.node.kind === 'file' ? props.selectedSet.has(props.node.index) : false
)

/** Folder check state: 'all' | 'some' | 'none' across its descendant files. */
const folderState = computed<'all' | 'some' | 'none'>(() => {
  if (props.node.kind !== 'folder') return 'none'
  const idx = props.node.fileIndices
  if (idx.length === 0) return 'none'
  const sel = idx.filter((i) => props.selectedSet.has(i)).length
  if (sel === 0) return 'none'
  if (sel === idx.length) return 'all'
  return 'some'
})

const checked = computed(() =>
  props.node.kind === 'file' ? fileChecked.value : folderState.value === 'all'
)
const indeterminate = computed(() =>
  props.node.kind === 'folder' && folderState.value === 'some'
)

function toggle(): void {
  if (props.node.kind === 'file') {
    emit('set', [props.node.index], !fileChecked.value)
  } else {
    // Folder: turn the whole subtree on unless it's already fully selected.
    emit('set', props.node.fileIndices, folderState.value !== 'all')
  }
}

function toggleCollapse(): void {
  if (props.node.kind === 'folder') collapsed.value = !collapsed.value
}
</script>

<template>
  <div :class="node.kind === 'folder' ? 'node-folder' : 'node-file'" :data-collapsed="collapsed">
    <!-- Folder row -->
    <div
      v-if="node.kind === 'folder'"
      class="trow folder-row"
      :data-testid="`tree-folder-${node.name}`"
      @click="toggleCollapse"
    >
      <button
        type="button"
        class="caret"
        :class="{ 'caret--collapsed': collapsed }"
        :aria-label="collapsed ? 'Развернуть' : 'Свернуть'"
        @click.stop="toggleCollapse"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <Checkbox
        :checked="checked"
        :indeterminate="indeterminate"
        :data-testid="`tree-check-folder-${node.name}`"
        @click.stop
        @change="toggle"
      />
      <span class="gly" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 01-2 2H3z" /></svg>
      </span>
      <span class="nm"><span class="lbl">{{ node.name }}</span></span>
      <span class="fsz">{{ formatBytes(node.size) }}</span>
    </div>

    <!-- File row -->
    <div v-else class="trow file-row" :data-testid="`tree-file-${node.index}`">
      <span class="fileindent" aria-hidden="true"></span>
      <Checkbox
        :checked="checked"
        :data-testid="`tree-check-${node.index}`"
        @change="toggle"
      />
      <span class="nm">
        <span class="lbl" data-testid="tree-label">{{ node.label }}</span>
        <span class="raw" data-testid="tree-raw">{{ node.raw }}</span>
      </span>
      <span class="fsz">{{ formatBytes(node.size) }}</span>
    </div>

    <!-- Children (folders only) -->
    <div v-if="node.kind === 'folder' && !collapsed" class="children">
      <TreeNode
        v-for="(child, i) in node.children"
        :key="child.kind === 'file' ? `f${child.index}` : `d${child.name}${i}`"
        :node="child"
        :selected-set="selectedSet"
        :depth="depth + 1"
        @set="(idx, on) => emit('set', idx, on)"
      />
    </div>
  </div>
</template>

<style scoped>
/* A row: checkbox + (glyph/indent) + name + size. No per-row box — hairline
   dividers only (the border-diet principle from #123). 44px min touch target. */
.trow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline-color);
}
.node-folder:last-child > .trow,
.node-file:last-child > .trow {
  border-bottom: 0;
}
.folder-row {
  cursor: pointer;
}

/* Caret toggles collapse; rotated -90° when collapsed. */
.caret {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--ink);
  transition: transform 0.15s var(--ease-out, ease);
}
.caret--collapsed {
  transform: rotate(-90deg);
}
.caret svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Folder glyph — quiet. */
.gly {
  flex: 0 0 auto;
  display: flex;
  opacity: 0.55;
}
.gly svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* File rows align their checkbox under the folder caret column. */
.fileindent {
  flex: 0 0 auto;
  width: 8px;
}

/* Name column: bold label + dim mono raw filename. */
.nm {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nm .lbl {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm .raw {
  font-size: 10px;
  font-family: var(--mono, monospace);
  opacity: 0.42;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Size — small, dim, right-aligned, mono. */
.fsz {
  flex: 0 0 auto;
  font-family: var(--mono, monospace);
  font-size: 11px;
  opacity: 0.5;
  white-space: nowrap;
}

/* Nesting: thin 12px indent + 1px hairline guide. */
.children {
  padding-left: 12px;
  margin-left: 14px;
  border-left: 1px solid var(--hairline-color);
}
</style>
