<script setup lang="ts">
// Destination folder picker (#2). Primary view is a flat list of "quick" folders
// — your recent destinations plus the subfolders of the default media share
// (/video) — so it is never empty, even on a cold start. «Браузить все папки»
// opens a drill-down tree whose breadcrumb is tappable (each crumb navigates up
// to that level); there is no separate "Up" button. Emits the chosen path via
// v-model. Used by AddFlow (#63).
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useFolderShortcuts } from '../composables/useFolderShortcuts'
import LoadingText from './ui/LoadingText.vue'
import Skeleton from './ui/Skeleton.vue'
import type { FolderView } from '../types'

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

const { recents } = useFolderShortcuts()

// The share whose subfolders seed the quick list when there's no history yet.
// Single-user app (ADR 0001) → a constant suffices; centralised here if it ever
// needs to become configurable.
const DEFAULT_SHARE = '/video'
const QUICK_CAP = 8

// View mode: 'quick' (flat known folders, primary) or 'tree' (drill-down).
const view = ref<'quick' | 'tree'>('quick')

// Subfolders of the default share, fetched once — the cold-start seed.
const defaultChildren = ref<string[]>([])

// True while we're fetching the default-share children on mount.
// We hold the quick-list render until this resolves so there is no 2→2 pop-in.
const quickLoading = ref(true)

// Number of skeleton tiles to show while quickLoading; prefer recents count
// (already known) or fall back to the cap so the placeholder looks reasonable.
const SKELETON_COUNT = 4

// Quick list = recents first, then default-share subfolders, deduped + capped.
// Recents float to the top as they're used; the default-share children keep it
// from ever being empty.
const quickFolders = computed<string[]>(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [...recents.value, ...defaultChildren.value]) {
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out.slice(0, QUICK_CAP)
})

// ── Tree drill-down state ──
// Breadcrumb stack: each entry is the { name, path } of a folder we entered.
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

onMounted(async () => {
  // Seed the quick list from the default share's subfolders.
  try {
    const children = await api.folders(DEFAULT_SHARE)
    defaultChildren.value = children.map((f) => f.path)
  } catch {
    defaultChildren.value = []
  } finally {
    // Release the skeleton once we have the full merged list.
    quickLoading.value = false
  }
  // If there is genuinely nothing to quick-pick (default share empty/unreachable
  // and no recents), drop straight into the tree so the step is never blank.
  if (quickFolders.value.length === 0) {
    view.value = 'tree'
    await loadFolders()
  }
})

function pickQuick(path: string): void {
  emit('update:modelValue', path)
}

async function openTree(): Promise<void> {
  view.value = 'tree'
  if (folders.value.length === 0 && stack.value.length === 0 && !loading.value) {
    await loadFolders()
  }
}

function backToQuick(): void {
  view.value = 'quick'
}

async function drillInto(folder: FolderView): Promise<void> {
  stack.value = [...stack.value, folder]
  // Entering a folder selects it as the destination, so the wizard's «Далее»
  // already means "save here".
  emit('update:modelValue', folder.path)
  await loadFolders(folder.path)
}

// Tappable breadcrumb replaces the old "Up" button: jump to a crumb level.
// index -1 → back to the share root; 0..n → that crumb.
async function jumpTo(index: number): Promise<void> {
  stack.value = stack.value.slice(0, index + 1)
  emit('update:modelValue', currentPath() ?? '')
  await loadFolders(currentPath())
}

// Helper: short display name from a path (the leaf segment).
function shortName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// ── Pop-one-level Back (G1 #216) ──
// The parent (AddFlow) consults these on a native Back press so Back pops ONE
// folder-nav level before it touches the wizard step. canStepBack() is true
// whenever we're in the tree view; stepBack() pops a single breadcrumb level,
// and at the tree root drops back to the quick list.
function canStepBack(): boolean {
  return view.value === 'tree'
}

function stepBack(): void {
  if (view.value !== 'tree') return
  if (stack.value.length > 0) {
    // Pop ONE crumb. jumpTo(i) truncates the stack to i+1 entries, so
    // jumpTo(length - 2) keeps length-1 crumbs (drops the deepest one);
    // length - 2 === -1 at depth 1 → back to the tree root.
    void jumpTo(stack.value.length - 2)
  } else {
    // Already at the tree root → return to the quick list.
    backToQuick()
  }
}

defineExpose({ canStepBack, stepBack })
</script>

<template>
  <div class="folder-picker">

    <!-- ── PRIMARY: flat quick folders (never empty) ── -->
    <div v-if="view === 'quick'" class="quick-view">
      <span class="quick-label">Куда сохранить</span>

      <!-- Skeleton placeholders while the full quick-list is still loading.
           Shown instead of the partial list (recents-only) to avoid a 2→2 pop-in. -->
      <ul v-if="quickLoading" class="quick-list" role="list" aria-busy="true" aria-label="Загрузка папок">
        <li v-for="n in SKELETON_COUNT" :key="n">
          <Skeleton class="folder-tile-skeleton" />
        </li>
      </ul>

      <ul v-else class="quick-list" role="list" data-testid="folder-tiles">
        <li v-for="path in quickFolders" :key="path">
          <button
            type="button"
            class="folder-tile nb-pressable"
            :class="{ 'folder-tile--selected': modelValue === path }"
            data-testid="folder-tile"
            :title="path"
            @click="pickQuick(path)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" class="tile-icon">
              <path d="M3 7h6l2 2h10v9a2 2 0 01-2 2H3z" />
            </svg>
            <span class="tile-name">{{ shortName(path) }}</span>
            <span class="tile-indicator" :class="{ 'tile-indicator--selected': modelValue === path }" aria-hidden="true"></span>
          </button>
        </li>
      </ul>

      <!-- Link to the tree drill-down -->
      <button
        type="button"
        class="more-link"
        data-testid="open-tree-btn"
        @click="openTree"
      >
        Браузить все папки
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="more-link-arrow">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>

    <!-- ── SECONDARY: tree drill-down with a tappable breadcrumb ── -->
    <div v-else class="tree-view">
      <nav class="crumbs" aria-label="Путь">
        <!-- Returns to the quick list; the home crumb + folder crumbs are tappable
             to jump up a level (replaces the old "Up" button). #200: icon-only
             (the folder-list word was dropped) — the quick-list tiles read as folders. -->
        <button
          type="button"
          class="crumb crumb--quick"
          data-testid="back-to-tiles-btn"
          aria-label="К списку папок"
          @click="backToQuick"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="crumb-quick-icon"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <span class="crumb-sep" aria-hidden="true">·</span>
        <button
          type="button"
          class="crumb"
          :class="{ 'crumb--current': stack.length === 0 }"
          data-testid="crumb-root"
          aria-label="Все папки"
          @click="jumpTo(-1)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="crumb-home"><path d="M3 11l9-8 9 8M5 9v11h14V9" /></svg>
        </button>
        <template v-for="(crumb, i) in stack" :key="crumb.path">
          <span class="crumb-sep" aria-hidden="true">/</span>
          <button
            type="button"
            class="crumb"
            :class="{ 'crumb--current': i === stack.length - 1 }"
            data-testid="crumb"
            @click="jumpTo(i)"
          >
            {{ crumb.name }}
          </button>
        </template>
      </nav>

      <!-- Loading indicator -->
      <LoadingText v-if="loading" class="picker-loading" data-testid="loading" />

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
          Нет подпапок
        </li>
      </ul>

      <!-- No "Save here" button: entering a folder selects it, and the wizard
           footer «Далее» advances with that selection. -->
    </div>

  </div>
</template>

<style scoped>
.folder-picker {
  display: flex;
  flex-direction: column;
}

/* ── Quick view ── */
.quick-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.quick-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.45;
}

.quick-list {
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
  /* Force ink text + reset native control look (iOS button text → accent blue). */
  appearance: none;
  -webkit-appearance: none;
  color: var(--ink);
  -webkit-text-fill-color: var(--ink);
  /* Press via .nb-pressable — sinks 3px (matches --shadow-sm). */
}

.folder-tile--selected {
  border: var(--border-strong);
  box-shadow: var(--shadow-md);
  background: var(--yellow);
  /* Selected tile presses 5px to match shadow-md depth. */
  --press: 5px;
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

/* Skeleton placeholder matches the tile height so the list height is stable. */
.folder-tile-skeleton {
  height: 60px;
  border-radius: var(--radius);
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

/* Tappable breadcrumb (replaces the old back-to-tiles + Up buttons). */
.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-height: 44px;
}

.crumb {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  border: none;
  padding: var(--space-1) 2px;
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  color: var(--ink);
  -webkit-text-fill-color: var(--ink);
  opacity: 0.55;
  cursor: pointer;
}

/* #200: icon-only back-to-tiles control (the folder-list word was dropped). */
.crumb--quick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.crumb-quick-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.crumb-home {
  width: 16px;
  height: 16px;
  display: block;
}

.crumb--current {
  opacity: 1;
}

.crumb-sep {
  opacity: 0.35;
  font-size: var(--fs-sm);
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
  /* Force ink text + reset native control look — iOS renders <button> text in
     the system accent (blue) unless color + -webkit-text-fill-color are set. */
  appearance: none;
  -webkit-appearance: none;
  color: var(--ink);
  -webkit-text-fill-color: var(--ink);
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
</style>
