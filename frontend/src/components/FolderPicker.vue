<script setup lang="ts">
// Drill-down destination folder picker. Used by AddFlow (#63); #71 will reuse it.
// Starts from shared-folder roots (no path), clicking drills into children.
// Emits the chosen path via v-model.
// #122 Variant D: primary screen = known-folder tiles (favorites+recents).
// Tree is behind "Выбрать другую папку…". No history → tree shown directly.
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

// Tiles: favorites first (pinned), then recents (deduped), cap 6 total
const tiles = computed<string[]>(() => {
  const favSet = new Set(favorites.value)
  const favs = favorites.value.slice()
  const recentOnly = recents.value.filter((p) => !favSet.has(p))
  return [...favs, ...recentOnly].slice(0, 6)
})

// Whether there is known-folder history to show tiles for.
// If false → go straight to the tree; no empty tiles screen.
const hasTiles = computed(() => tiles.value.length > 0)

// View mode: 'tiles' (primary) or 'tree' (drill-down)
const view = ref<'tiles' | 'tree'>('tiles')

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
  let resolvedPath = ''
  while (true) {
    // Find a folder in the current level that is either the exact target
    // or a proper path-prefix of the target
    const match = levelFolders.find((f) => {
      return f.path === absPath || absPath.startsWith(f.path + '/')
    })

    if (!match) return false

    newStack.push(match)
    resolvedPath = match.path

    if (resolvedPath === absPath) {
      // We've reached the target — load its children
      let children: FolderView[]
      try {
        children = await api.folders(resolvedPath)
      } catch {
        children = []
      }
      stack.value = newStack
      folders.value = children
      return true
    }

    // Drill deeper
    try {
      levelFolders = await api.folders(resolvedPath)
    } catch {
      return false
    }
  }
}

onMounted(async () => {
  if (!hasTiles.value) {
    // No known folders → go straight to the tree
    view.value = 'tree'
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
  } else {
    // Primary tiles view: tree not loaded yet (lazy)
    view.value = 'tiles'
  }
})

async function openTree(): Promise<void> {
  view.value = 'tree'
  // Load root if tree has never been opened before
  if (folders.value.length === 0 && !loading.value && stack.value.length === 0) {
    await loadFolders()
  }
}

function backToTiles(): void {
  view.value = 'tiles'
}

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

function pickTile(path: string): void {
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

// Helper: short display name from a path
function shortName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
</script>

<template>
  <div class="folder-picker">

    <!-- ── PRIMARY: known-folder tiles ── -->
    <div v-if="view === 'tiles'" class="tiles-view">
      <span class="tiles-label">Куда сохранить</span>

      <ul class="tiles-list" role="list" data-testid="folder-tiles">
        <li v-for="tilePath in tiles" :key="tilePath">
          <button
            type="button"
            class="folder-tile nb-pressable"
            :class="{ 'folder-tile--selected': modelValue === tilePath, 'folder-tile--favorite': favorites.includes(tilePath) }"
            data-testid="folder-tile"
            :title="tilePath"
            @click="pickTile(tilePath)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" class="tile-icon">
              <path d="M3 7h6l2 2h10v9a2 2 0 01-2 2H3z" />
            </svg>
            <span class="tile-name">{{ shortName(tilePath) }}</span>
            <span class="tile-indicator" :class="{ 'tile-indicator--selected': modelValue === tilePath }" aria-hidden="true"></span>
          </button>
        </li>
      </ul>

      <!-- Link to tree drill-down -->
      <button
        type="button"
        class="more-link"
        data-testid="open-tree-btn"
        @click="openTree"
      >
        Выбрать другую папку
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="more-link-arrow">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>

    <!-- ── SECONDARY: tree drill-down ── -->
    <div v-else class="tree-view">
      <!-- Back to tiles — only shown if tiles are available -->
      <div class="tree-nav">
        <button
          v-if="hasTiles"
          type="button"
          class="back-to-tiles nb-pressable"
          data-testid="back-to-tiles-btn"
          @click="backToTiles"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" class="nav-arrow">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Назад
        </button>
        <span v-else class="tree-title">Выбрать папку</span>

        <!-- Breadcrumb / up navigation -->
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
      </div>

      <!-- Breadcrumb path display -->
      <div class="breadcrumb" aria-label="Current path">
        <span v-if="stack.length === 0" class="crumb-root">/ (root)</span>
        <span v-for="(crumb, i) in stack" :key="crumb.path" class="crumb">
          <span v-if="i > 0" class="crumb-sep">/</span>{{ crumb.name }}
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="drill-arrow">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </li>
        <li v-if="folders.length === 0 && !loading" class="picker-empty">
          No subfolders
        </li>
      </ul>

      <!-- "Save here" action — available when inside a folder (not at root) -->
      <Button
        v-if="stack.length > 0"
        variant="primary"
        size="lg"
        class="pick-btn"
        data-testid="pick-btn"
        @click="pickCurrent"
      >
        Сохранить сюда
      </Button>
    </div>

  </div>
</template>

<style scoped>
.folder-picker {
  display: flex;
  flex-direction: column;
}

/* ── Tiles view ── */
.tiles-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tiles-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.45;
}

.tiles-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Large folder tile — border, offset shadow, mechanical press.
 * min-height 60px (>= 44px touch target). */
.folder-tile {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 60px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  /* Press via .nb-pressable — sinks 3px (matches --shadow-sm). */
}

.folder-tile--selected {
  border: var(--border-strong);
  box-shadow: var(--shadow-md);
  background: var(--yellow);
  /* Selected tile presses 5px to match shadow-md depth. */
  --press: 5px;
}

.folder-tile--favorite {
  background: var(--yellow);
}

.tile-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--ink);
  opacity: 0.75;
}

.tile-name {
  flex: 1;
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Selection indicator ring */
.tile-indicator {
  width: 22px;
  height: 22px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease-out);
}
.tile-indicator--selected {
  background: var(--ink);
}

/* Quiet link to open the tree */
.more-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.more-link:hover,
.more-link:focus-visible {
  opacity: 0.85;
}

.more-link-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* ── Tree view ── */
.tree-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tree-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
}

.back-to-tiles {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: var(--space-1) var(--space-2);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}

.tree-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.nav-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
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
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  margin-left: auto;
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
  opacity: 0.6;
  min-height: 20px;
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
  font-family: var(--font);
  font-size: var(--fs-md);
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

.drill-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.35;
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
  margin-top: var(--space-2);
}
</style>
