<script setup lang="ts">
// Destination folder picker (#2). Primary view is a flat list of "quick" folders
// — your recent destinations plus the subfolders of the default media share
// (/video) — so it is never empty, even on a cold start. «Все папки» opens a
// drill-down tree whose breadcrumb is tappable (each crumb navigates up to that
// level); there is no separate "Up" button. Emits the chosen path via v-model.
// Used by AddFlow (#63).
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

      <!-- ONE grouped panel (#101): a single black frame whose rows are divided
           by quiet hairlines — not a stack of identical bordered boxes. The
           selected row fills yellow edge-to-edge; the panel is .nb-framed so the
           fill bleeds into the rounded corners with no sliver. «Все папки» is the
           final action row, visually subordinate to the destinations above it. -->
      <div class="folder-panel nb-framed">

        <!-- Skeleton rows while the merged quick-list loads. Shown instead of the
             partial (recents-only) list to avoid a 2→2 pop-in; keeps panel height
             stable. -->
        <ul v-if="quickLoading" class="folder-rows" role="list" aria-busy="true" aria-label="Загрузка папок">
          <li v-for="n in SKELETON_COUNT" :key="n" class="folder-row folder-row--skeleton">
            <Skeleton class="row-skeleton" />
          </li>
        </ul>

        <ul v-else class="folder-rows" role="radiogroup" aria-label="Куда сохранить" data-testid="folder-tiles">
          <li v-for="path in quickFolders" :key="path">
            <button
              type="button"
              class="folder-row"
              :class="{ 'folder-row--selected': modelValue === path }"
              role="radio"
              :aria-checked="modelValue === path"
              data-testid="folder-tile"
              :title="path"
              @click="pickQuick(path)"
            >
              <!-- Outline folder when unselected → solid ink folder when selected:
                   a non-colour selection cue on top of the yellow fill + check. -->
              <svg
                viewBox="0 0 24 24"
                :fill="modelValue === path ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linejoin="round"
                aria-hidden="true"
                class="row-icon"
              >
                <path d="M3 7h6l2 2h10v9a2 2 0 01-2 2H3z" />
              </svg>
              <span class="row-name">{{ shortName(path) }}</span>
              <svg
                v-if="modelValue === path"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                class="row-check"
              >
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </button>
          </li>
        </ul>

        <!-- Final action row: drill into the full folder tree. -->
        <button
          v-if="!quickLoading"
          type="button"
          class="browse-row"
          data-testid="open-tree-btn"
          @click="openTree"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="browse-icon">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
          <span class="browse-label">Все папки</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="browse-arrow">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- ── SECONDARY: tree drill-down with a tappable breadcrumb ── -->
    <div v-else class="tree-view">
      <nav class="crumbs" aria-label="Путь">
        <!-- No in-app "back to folders" control (round-2): the native Telegram Back
             button drives it. Inside a folder, Back pops one level; at the tree root
             Back returns to the pre-picked quick list. That's wired via the exposed
             stepBack() (AddFlow.onBack). The home + path crumbs remain tappable. -->
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

      <!-- Folder list — same grouped-panel language as the quick view. -->
      <div v-else class="folder-panel nb-framed">
        <ul class="folder-rows" role="list">
          <li v-for="folder in folders" :key="folder.path">
            <button
              type="button"
              class="folder-row folder-row--drill"
              data-testid="folder-item"
              @click="drillInto(folder)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true" class="row-icon">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <span class="row-name">{{ folder.name }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="row-drill">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </li>
          <li v-if="folders.length === 0 && !loading" class="picker-empty">
            Нет подпапок
          </li>
        </ul>
      </div>

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

/* ── The one grouped panel (#101) ──
 * A single rounded black frame (the .nb-framed inset outline — NOT a per-row
 * border) plus the neo-brutalist offset drop shadow for lift. Rows live
 * full-bleed inside it, divided by quiet hairlines, so the list reads as ONE
 * card with calm rows rather than a stack of identical bordered boxes. */
.folder-panel {
  background: var(--paper);
  box-shadow: var(--shadow-md);
  --nb-frame-w: var(--border-thin);
}

.folder-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A quiet row. Full-bleed (no own border/radius); the panel frame owns the
 * outline, and a hairline divides each row from the one above it. */
.folder-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 52px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: none;
  border-top: var(--hairline);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  /* Force ink text + reset native control look (iOS button text → accent blue). */
  appearance: none;
  -webkit-appearance: none;
  color: var(--ink);
  -webkit-text-fill-color: var(--ink);
  /* Rows press with a tint, not the mechanical translate — they sit inside a
   * fixed frame, so moving an individual row would look broken. */
  transition: background var(--dur-fast) var(--ease-out);
}

/* The first row of a panel butts against the frame's top edge — no divider. */
.folder-rows > li:first-child .folder-row {
  border-top: none;
}

/* Press tint for tappable rows (skip the selected one — it's already filled). */
.folder-row:not(.folder-row--selected):active {
  background: var(--ink-active);
}

/* Selected destination: the whole row fills yellow, edge-to-edge. */
.folder-row--selected {
  background: var(--yellow);
}

.row-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--ink);
  opacity: 0.7;
}
/* Selected → solid ink folder at full strength (outline → filled is the
 * non-colour selection cue, alongside the check). */
.folder-row--selected .row-icon {
  opacity: 1;
}

.row-name {
  flex: 1;
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-check {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: var(--ink);
}

/* Drill chevron on tree rows. */
.row-drill {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.35;
  color: var(--ink);
}

/* Skeleton row — same height as a real row so the panel doesn't jump. */
.folder-row--skeleton {
  pointer-events: none;
}
.row-skeleton {
  height: 20px;
  width: 55%;
  border-radius: var(--radius-pill);
}

/* ── «Все папки» — the final action row ──
 * A row, but visually subordinate to the destinations above: muted glyph + a
 * smaller uppercase label + a forward chevron that signals "drill deeper". */
.browse-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 48px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: none;
  border-top: var(--hairline);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  appearance: none;
  -webkit-appearance: none;
  color: var(--ink);
  -webkit-text-fill-color: var(--ink);
  transition: background var(--dur-fast) var(--ease-out);
}
.browse-row:active {
  background: var(--ink-active);
}

.browse-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: var(--ink);
  opacity: 0.4;
}

.browse-label {
  flex: 1;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  opacity: 0.55;
}

.browse-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.4;
}

/* ── Tree view ── */
.tree-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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

.picker-empty {
  padding: var(--space-4);
  font-size: var(--fs-sm);
  opacity: 0.5;
  text-align: center;
}
</style>
