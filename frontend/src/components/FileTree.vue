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
import { computed } from 'vue'
import type { FileTree } from './fileTree'
import TreeNode from './TreeNode.vue'

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
</script>

<template>
  <div class="tree" data-testid="file-tree">
    <p v-if="tree.rootCrumb" class="tree-crumb" data-testid="tree-crumb">
      {{ tree.rootCrumb }}
    </p>
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

.tree-body {
  overflow-y: auto;
  min-height: 0;
}
</style>
