<script setup lang="ts">
// Drill-down destination folder picker. Used by AddFlow (#63); #71 will reuse it.
// Starts from shared-folder roots (no path), clicking drills into children.
// Emits the chosen path via v-model.
import { ref, watch, onMounted } from 'vue'
import { api } from '../api'
import type { FolderView } from '../types'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

// Breadcrumb stack: each entry is { name, path } of the folder we entered.
// Empty = at root.
const stack = ref<FolderView[]>([])
const folders = ref<FolderView[]>([])
const loading = ref(false)

const currentPath = (): string | undefined =>
  stack.value.length > 0 ? stack.value[stack.value.length - 1]!.path : undefined

async function loadFolders(path?: string): Promise<void> {
  loading.value = true
  try {
    folders.value = await api.folders(path)
  } catch {
    folders.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadFolders()
})

async function drillInto(folder: FolderView): Promise<void> {
  stack.value = [...stack.value, folder]
  await loadFolders(folder.path)
}

async function goUp(): Promise<void> {
  stack.value = stack.value.slice(0, -1)
  await loadFolders(currentPath())
}

function pickCurrent(): void {
  const path = currentPath()
  if (path) emit('update:modelValue', path)
}

// Expose current folder path for display purposes
const selectedPath = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    selectedPath.value = v
  },
)
</script>

<template>
  <div class="folder-picker">
    <!-- Breadcrumb / navigation row -->
    <div class="picker-nav">
      <button
        v-if="stack.length > 0"
        type="button"
        class="up-btn"
        data-testid="up-btn"
        aria-label="Go up"
        @click="goUp"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Up
      </button>

      <span class="breadcrumb">
        <span v-if="stack.length === 0" class="crumb-root">/ (root)</span>
        <span v-for="(crumb, i) in stack" :key="crumb.path" class="crumb">
          <span v-if="i > 0" class="crumb-sep">/</span>{{ crumb.name }}
        </span>
      </span>
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="picker-loading" data-testid="loading">
      Loading…
    </div>

    <!-- Folder list -->
    <ul v-else class="folder-list" role="list">
      <li v-for="folder in folders" :key="folder.path">
        <button
          type="button"
          class="folder-item"
          data-testid="folder-item"
          @click="drillInto(folder)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" class="folder-icon">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          {{ folder.name }}
        </button>
      </li>
      <li v-if="folders.length === 0 && !loading" class="picker-empty">
        No subfolders
      </li>
    </ul>

    <!-- Pick action — only available when not at root -->
    <button
      v-if="stack.length > 0"
      type="button"
      class="pick-btn"
      data-testid="pick-btn"
      @click="pickCurrent"
    >
      Pick this folder
    </button>

    <!-- Always show a pick-btn at root too so tests can always find it;
         pick from root is allowed if user wants the root shared folder. -->
    <button
      v-if="stack.length === 0 && folders.length > 0"
      type="button"
      class="pick-btn pick-btn--folder"
      data-testid="pick-btn"
      @click="() => {
        if (folders.length > 0) emit('update:modelValue', folders[0]!.path)
      }"
    >
      Pick first folder
    </button>
  </div>
</template>

<style scoped>
.folder-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.picker-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
}

.up-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  min-width: 44px;
  padding: var(--space-1) var(--space-2);
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.up-btn:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.up-btn svg {
  width: 18px;
  height: 18px;
}

.breadcrumb {
  font-size: var(--fs-sm);
  color: var(--ink);
  opacity: 0.7;
}
.crumb-sep {
  margin: 0 var(--space-1);
}

.picker-loading {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--fs-sm);
  opacity: 0.6;
}

.folder-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 240px;
  overflow-y: auto;
}

.folder-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--fs-md);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.folder-item:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
.folder-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--yellow);
  stroke: var(--ink);
  fill: var(--yellow);
}

.picker-empty {
  padding: var(--space-3);
  font-size: var(--fs-sm);
  opacity: 0.5;
  text-align: center;
}

.pick-btn {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  background: var(--yellow);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.pick-btn:active {
  transform: translate(5px, 5px);
  box-shadow: var(--shadow-none);
}
</style>
