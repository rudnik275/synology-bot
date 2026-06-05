<script setup lang="ts">
// Confirm-step file tree (#123). A collapsible tree with real nesting, one
// SQUARE checkbox per row driving the file subset sent to the Synology BT.File
// call. Folders collapse on tap and carry a checkbox that selects/clears their
// whole subtree; a file row shows the bold #117-style label + the dim full
// filename in mono underneath, with the size small/dim on the right.
//
// Border diet (the screen principle from the РЕШЕНО round): NO box around the
// tree — it lives directly inside the confirm card on hairline dividers. Nodes
// are rendered by the recursive TreeNode component below.
//
// Root-group toggle (#217): when files sit directly at the torrent root level
// (rootFileIndices is non-empty), a master checkbox in the header row lets the
// user select/deselect all root files at once, mirroring folder behavior.
import { computed } from 'vue'
import type { FileTree, InspectFile } from './fileTree'
import { allIndices } from './fileTree'
import TreeNode from './TreeNode.vue'
import Checkbox from './ui/Checkbox.vue'

const props = defineProps<{
  tree: FileTree
  /** Currently selected file indices (the BT.File subset). v-model. */
  selected: number[]
  /** Full flat file list — needed for the top-level master select-all (#251). */
  files: InspectFile[]
}>()

const emit = defineEmits<{ 'update:selected': [number[]] }>()

const selectedSet = computed(() => new Set(props.selected))

function setSelected(indices: number[], on: boolean): void {
  const next = new Set(props.selected)
  for (const i of indices) {
    if (on) next.add(i)
    else next.delete(i)
  }
  emit('update:selected', [...next])
}

/** State of the root-group master checkbox: 'all' | 'some' | 'none'. */
const rootGroupState = computed<'all' | 'some' | 'none'>(() => {
  const idx = props.tree.rootFileIndices
  if (idx.length === 0) return 'none'
  const sel = idx.filter((i) => selectedSet.value.has(i)).length
  if (sel === 0) return 'none'
  if (sel === idx.length) return 'all'
  return 'some'
})

function toggleRootGroup(): void {
  setSelected(props.tree.rootFileIndices, rootGroupState.value !== 'all')
}

/** All file indices across the entire tree (root + all folder descendants). */
const allFileIndices = computed(() => allIndices(props.files))

/** State of the master top-level checkbox: 'all' | 'some' | 'none'. */
const allState = computed<'all' | 'some' | 'none'>(() => {
  const idx = allFileIndices.value
  if (idx.length === 0) return 'none'
  const sel = idx.filter((i) => selectedSet.value.has(i)).length
  if (sel === 0) return 'none'
  if (sel === idx.length) return 'all'
  return 'some'
})

function toggleAll(): void {
  setSelected(allFileIndices.value, allState.value !== 'all')
}
</script>

<template>
  <div class="tree" data-testid="file-tree">
    <p v-if="tree.rootCrumb" class="tree-crumb" data-testid="tree-crumb">
      {{ tree.rootCrumb }}
    </p>
    <!-- Master select-all: top-level checkbox over ENTIRE tree (root + folders) (#251). -->
    <div v-if="allFileIndices.length > 0" class="trow master-row">
      <Checkbox
        :checked="allState === 'all'"
        :indeterminate="allState === 'some'"
        data-testid="tree-check-all"
        @change="toggleAll"
      />
      <span class="master-label">Все файлы · {{ allFileIndices.length }}</span>
    </div>
    <!-- Root-group header: master checkbox for files sitting directly at root (#217). -->
    <div v-if="tree.rootFileIndices.length > 0" class="trow root-group-row">
      <Checkbox
        :checked="rootGroupState === 'all'"
        :indeterminate="rootGroupState === 'some'"
        data-testid="tree-check-root"
        @change="toggleRootGroup"
      />
      <span class="root-group-label">Файлы · {{ tree.rootFileIndices.length }}</span>
    </div>
    <div class="tree-body">
      <TreeNode
        v-for="(node, i) in tree.nodes"
        :key="node.kind === 'file' ? `f${node.index}` : `d${node.name}${i}`"
        :node="node"
        :selected-set="selectedSet"
        :depth="0"
        @set="setSelected"
      />
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* #214: fill the Files block so .tree-body is the single scroll region —
     the confirm-step header/chips/files-header/destination stay pinned. */
  flex: 1;
}

/* The collapsed single-root folder, shown as a quiet crumb above the tree. */
.tree-crumb {
  margin: 0 0 var(--space-1);
  font-family: var(--mono, monospace);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Master row — top-level select-all over the entire tree (#251). */
.master-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

/* Root-group header row — master select-all for loose root-level files (#217). */
.trow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline-color);
}
.root-group-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}

.tree-body {
  overflow-y: auto;
  min-height: 0;
}
</style>
