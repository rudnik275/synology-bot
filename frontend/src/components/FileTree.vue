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
import type { FileTree } from './fileTree'
import TreeNode from './TreeNode.vue'
import Checkbox from './ui/Checkbox.vue'

const props = defineProps<{
  tree: FileTree
  /** Currently selected file indices (the BT.File subset). v-model. */
  selected: number[]
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
</script>

<template>
  <div class="tree" data-testid="file-tree">
    <p v-if="tree.rootCrumb" class="tree-crumb" data-testid="tree-crumb">
      {{ tree.rootCrumb }}
    </p>
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
