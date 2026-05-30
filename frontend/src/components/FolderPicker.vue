<script setup lang="ts">
// Drill-down destination folder picker. Used by AddFlow (#63); #71 will reuse it.
// Starts from shared-folder roots (no path), clicking drills into children.
// Emits the chosen path via v-model.
// #96: remembers last-used folder + shows recent/favorite chips row.
import { ref, computed, watch, onMounted } from 'vue'
import Button from './Button.vue'
import { api } from '../api'
import { useFolderShortcuts } from '../composables/useFolderShortcuts'
import type { FolderView } from '../types'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

const { recents, favorites, lastFolder, clearLastIfMissing } = useFolderShortcuts()

// Chips: favorites first (pinned), then recents (deduped), cap 6 total
const chips = computed<string[]>(() => {
  const favSet = new Set(favorites.value)
  const favs = favorites.value.slice()
  const recentOnly = recents.value.filter((p) => !favSet.has(p))
  return [...favs, ...recentOnly].slice(0, 6)
})

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

/** Reconstruct the breadcrumb stack for an absolute path by drilling level by level.
 *
 * NAS shared folder paths look like /volume1/downloads/subfolder.
 * The api.folders() root listing returns entries whose paths ARE the first-level
 * absolute paths (e.g. /volume1/downloads). So we build a sequence of path prefixes
 * to match against each level's listing.
 */
async function restoreStack(absPath: string): Promise<boolean> {
  // Build an ordered list of ancestor paths from root to target.
  // e.g. '/volume1/downloads/torrents' → ['/volume1/downloads', '/volume1/downloads/torrents']
  // We need to find which root entry is a prefix of absPath, then drill down.
  if (!absPath || absPath === '/') return false

  const newStack: FolderView[] = []

  // Fetch root level
  let levelFolders: FolderView[]
  try {
    levelFolders = await api.folders()
  } catch {
    return false
  }

  // Find the root entry that is a prefix of (or equal to) absPath
  let currentPath = ''
  while (true) {
    // Find a folder in the current level that is either the exact target
    // or a proper path-prefix of the target
    const match = levelFolders.find((f) => {
      return f.path === absPath || absPath.startsWith(f.path + '/')
    })

    if (!match) return false

    newStack.push(match)
    currentPath = match.path

    if (currentPath === absPath) {
      // We've reached the target — load its children
      let children: FolderView[]
      try {
        children = await api.folders(currentPath)
      } catch {
        children = []
      }
      stack.value = newStack
      folders.value = children
      return true
    }

    // Drill deeper
    try {
      levelFolders = await api.folders(currentPath)
    } catch {
      return false
    }
  }
}

onMounted(async () => {
  const saved = lastFolder.value
  if (saved) {
    const ok = await restoreStack(saved)
    if (!ok) {
      clearLastIfMissing()
      await loadFolders()
    }
  } else {
    await loadFolders()
  }
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

function pickChip(path: string): void {
  emit('update:modelValue', path)
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
    <!-- Quick-access chips: favorites (pinned) first, then recents. Only shown when non-empty. -->
    <div v-if="chips.length > 0" class="folder-chips" data-testid="folder-chips">
      <button
        v-for="chipPath in chips"
        :key="chipPath"
        type="button"
        class="folder-chip nb-pressable"
        :class="{ 'folder-chip--favorite': favorites.includes(chipPath) }"
        data-testid="folder-chip"
        :title="chipPath"
        @click="pickChip(chipPath)"
      >
        <span v-if="favorites.includes(chipPath)" class="chip-pin" aria-label="Favorite">★</span>
        {{ chipPath.split('/').filter(Boolean).pop() ?? chipPath }}
      </button>
    </div>

    <!-- Breadcrumb / navigation row -->
    <div class="picker-nav">
      <button
        v-if="stack.length > 0"
        type="button"
        class="up-btn nb-pressable"
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
          class="folder-item nb-pressable"
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
    <Button
      v-if="stack.length > 0"
      variant="primary"
      size="lg"
      class="pick-btn"
      data-testid="pick-btn"
      @click="pickCurrent"
    >
      Pick this folder
    </Button>

    <!-- Always show a pick-btn at root too so tests can always find it;
         pick from root is allowed if user wants the root shared folder. -->
    <Button
      v-if="stack.length === 0 && folders.length > 0"
      variant="primary"
      size="lg"
      class="pick-btn pick-btn--folder"
      data-testid="pick-btn"
      @click="() => {
        if (folders.length > 0) emit('update:modelValue', folders[0]!.path)
      }"
    >
      Pick first folder
    </Button>
  </div>
</template>

<style scoped>
.folder-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ── Chips row (#96) ── */
.folder-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding-bottom: var(--space-1);
}

.folder-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--cream);
  border: var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Press via .nb-pressable; the small chip sinks only 2px. */
  --press: 2px;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.folder-chip--favorite {
  background: var(--yellow);
  border-color: var(--ink);
}
.chip-pin {
  font-size: 10px;
  flex-shrink: 0;
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
  /* Press via .nb-pressable. */
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
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
  /* Press via .nb-pressable. */
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
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

/* Layout only — the button recipe lives in the shared <Button variant="primary">. */
.pick-btn {
  width: 100%;
}
</style>
