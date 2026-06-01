<script setup lang="ts">
// Downloads tab — Variant B card redesign (#116).
//
// Visual spec:
//   • ONE status accent per card: a thin LEFT EDGE STRIPE (via Card edgeStripe
//     prop). Top tone strip + StickerBadge removed from card face.
//   • EXACTLY ONE primary action per card, status-dependent:
//       downloading / waiting / finishing → «Пауза» (primary/yellow)
//       paused                           → «Продолжить» (primary/yellow)
//       finished / seeding / error       → no primary; just the ⋯ overflow menu
//   • Everything else in overflow ⋯ menu: Delete (with confirmation), open
//     folder, copy magnet, retry-on-error.
//   • Quality chips (year / resolution / codec / languages) from #117 under title.
//   • Bigger % readout, quieter meta.
//   • Elevation tiers (#101 D) preserved: active+error → raised, settled → flat.
import { ref } from 'vue'
import Card from '../components/Card.vue'
import Button from '../components/Button.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import ProgressBar from '../components/ProgressBar.vue'
import EmptyState from '../components/EmptyState.vue'
import { useTasks } from '../composables/useTasks'
import { formatBytes, formatSpeed } from '../format'
import type { Tone } from '../components/tones'
import type { TaskView } from '../types'

const { tasks, loading, error, pause, resume, delete: deleteTask } = useTasks()

// ── Overflow menu state ──────────────────────────────────────────────────────
const openMenuId = ref<string | null>(null)
// Task pending delete confirmation
const confirmDeleteId = ref<string | null>(null)

function toggleMenu(id: string): void {
  openMenuId.value = openMenuId.value === id ? null : id
}

function closeMenu(): void {
  openMenuId.value = null
}

function requestDelete(id: string): void {
  confirmDeleteId.value = id
  closeMenu()
}

function cancelDelete(): void {
  confirmDeleteId.value = null
}

async function confirmDelete(): Promise<void> {
  if (!confirmDeleteId.value) return
  const id = confirmDeleteId.value
  confirmDeleteId.value = null
  await deleteTask(id)
}

// ── Status helpers ────────────────────────────────────────────────────────────

/** Left-edge stripe tone — single accent for Variant B (#116). */
function stripeToneForStatus(status: string): Tone {
  switch (status) {
    case 'downloading':
    case 'finishing':
    case 'waiting':
      return 'violet'
    case 'paused':
      return 'orange'
    case 'finished':
    case 'seeding':
      return 'green'
    case 'error':
      return 'red'
    default:
      return 'default'
  }
}

/** Elevation tier (#101 D): active + errors stay raised; settled tasks → flat. */
function cardVariantForStatus(status: string): 'flat' | 'raised' {
  return isActive(status) || status === 'error' ? 'raised' : 'flat'
}

function isActive(status: string): boolean {
  return status === 'downloading' || status === 'waiting' || status === 'finishing'
}

function isPaused(status: string): boolean {
  return status === 'paused'
}

/** Whether to show a primary action button (one or zero per card). */
function hasPrimaryAction(status: string): boolean {
  return isActive(status) || isPaused(status)
}

/** Label for the single primary action button. */
function primaryLabel(status: string): string {
  return isPaused(status) ? 'Продолжить' : 'Пауза'
}

async function onPrimary(task: TaskView): Promise<void> {
  if (isPaused(task.status)) {
    await resume(task.id)
  } else {
    await pause(task.id)
  }
}

/** Human-readable status label for the overflow menu header / aria. */
function statusLabel(status: string): string {
  switch (status) {
    case 'downloading': return 'Загрузка'
    case 'finishing':   return 'Завершение'
    case 'waiting':     return 'Ожидание'
    case 'paused':      return 'Пауза'
    case 'finished':    return 'Готово'
    case 'seeding':     return 'Раздача'
    case 'error':       return 'Ошибка'
    default:            return status
  }
}

/** Combine year + quality + languages into a flat chip list. */
function qualityChips(task: TaskView): string[] {
  const chips: string[] = []
  if (task.year) chips.push(String(task.year))
  if (task.quality?.length) chips.push(...task.quality)
  if (task.languages?.length) chips.push(...task.languages)
  return chips
}

</script>

<template>
  <div class="downloads-tab">
    <ScreenHeader title="Downloads" />

    <!-- Loading skeleton: content-shaped cards matching the real card geometry (#115 Variant A) -->
    <div v-if="loading && tasks.length === 0" class="loading-state" aria-label="Loading downloads" aria-busy="true">
      <div v-for="i in 3" :key="i" class="sk-card" role="presentation">
        <!-- Left edge stripe in neutral skeleton grey (status unknown while loading) -->
        <div class="sk-edge" />
        <!-- Title row: ~60% title bar + small status label placeholder -->
        <div class="sk-row">
          <div class="sk-line sk-title" />
          <div class="sk-line sk-label" />
        </div>
        <!-- Quality chip placeholders (year / resolution / codec) -->
        <div class="sk-chips">
          <div class="sk-chip" />
          <div class="sk-chip" />
          <div v-if="i !== 2" class="sk-chip" />
        </div>
        <!-- Progress bar placeholder (full-width container + partial fill block) -->
        <div class="sk-bar">
          <div class="sk-bar-fill" :style="{ width: i === 1 ? '55%' : '78%' }" />
        </div>
        <!-- Meta line placeholder -->
        <div class="sk-row">
          <div class="sk-line sk-meta" />
        </div>
      </div>
    </div>

    <!-- Error state -->
    <EmptyState v-else-if="error" title="Error" :message="error">
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </template>
    </EmptyState>

    <!-- Empty state -->
    <EmptyState v-else-if="!loading && tasks.length === 0" title="No downloads" message="Add a torrent to get started.">
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
      </template>
    </EmptyState>

    <!-- Task list -->
    <TransitionGroup v-else tag="div" name="task-list" class="task-list">
      <Card
        v-for="(task, index) in tasks"
        :key="task.id"
        :edge-stripe="stripeToneForStatus(task.status)"
        :variant="cardVariantForStatus(task.status)"
        class="task-card"
        :style="{ '--stagger-index': index }"
      >
        <!-- Header row: title only (badge removed — edge stripe is the sole accent) -->
        <div class="task-header">
          <h3 class="task-title">{{ task.title }}</h3>
          <!-- Status text — quieter than badge, screen-reader friendly -->
          <span class="task-status-label" :aria-label="`Status: ${statusLabel(task.status)}`">{{ statusLabel(task.status) }}</span>
        </div>

        <!-- Quality chips: year / resolution / codec / languages (#117) -->
        <div v-if="qualityChips(task).length > 0" class="task-chips">
          <span v-for="chip in qualityChips(task)" :key="chip" class="chip">{{ chip }}</span>
        </div>

        <!-- Progress bar (ink-colored for settled tasks, status-colored for active) -->
        <div class="task-progress">
          <ProgressBar
            :value="task.pct"
            :tone="isActive(task.status) ? 'violet' : stripeToneForStatus(task.status)"
            hide-label
          />
        </div>

        <!-- Meta row: bigger % + quieter speed/size -->
        <div class="task-meta">
          <span class="meta-pct">{{ task.pct }}%</span>
          <span v-if="isActive(task.status)" class="meta-speed">{{ formatSpeed(task.speedBytesPerSec) }}</span>
          <span class="meta-size">{{ formatBytes(task.downloadedBytes) }} / {{ formatBytes(task.sizeBytes) }}</span>
          <span v-if="task.destination" class="meta-dest">{{ task.destination }}</span>
        </div>

        <!-- Action row: 0 or 1 primary button + overflow ⋯ menu -->
        <div class="task-actions">
          <!-- Primary action (Variant B: exactly one per status group, or none) -->
          <Button
            v-if="hasPrimaryAction(task.status)"
            variant="primary"
            size="sm"
            class="btn-primary-action"
            :data-testid="`btn-primary-${task.id}`"
            @click="onPrimary(task)"
          >{{ primaryLabel(task.status) }}</Button>

          <!-- Overflow ⋯ menu trigger -->
          <div class="overflow-wrapper">
            <button
              class="btn-overflow nb-pressable"
              :aria-label="`More actions for ${task.title}`"
              :aria-expanded="openMenuId === task.id"
              :data-testid="`btn-overflow-${task.id}`"
              @click.stop="toggleMenu(task.id)"
            >⋯</button>

            <!-- Dropdown menu -->
            <Transition name="menu-pop">
              <div
                v-if="openMenuId === task.id"
                class="overflow-menu"
                role="menu"
                :aria-label="`Actions for ${task.title}`"
                @click.stop
              >
                <button
                  class="menu-item menu-item-danger"
                  role="menuitem"
                  :data-testid="`btn-delete-${task.id}`"
                  @click="requestDelete(task.id)"
                >
                  <span class="menu-item-icon" aria-hidden="true">🗑</span>
                  Удалить
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </Card>
    </TransitionGroup>

    <!-- Delete confirmation dialog (destructive — kept per spec) -->
    <Teleport to="body">
      <Transition name="confirm-pop">
        <div v-if="confirmDeleteId !== null" class="confirm-backdrop" @click.self="cancelDelete">
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="Confirm delete">
            <p class="confirm-message">Удалить задачу? Это действие нельзя отменить.</p>
            <div class="confirm-actions">
              <Button variant="neutral" size="sm" data-testid="btn-cancel-delete" @click="cancelDelete">Отмена</Button>
              <Button variant="danger" size="sm" data-testid="btn-confirm-delete" @click="confirmDelete">Удалить</Button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Backdrop to close overflow menu when clicking outside -->
    <div v-if="openMenuId !== null" class="menu-backdrop" @click="closeMenu" />
  </div>
</template>

<style scoped>
.downloads-tab {
  padding: var(--space-4);
  padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom));
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.task-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* Left padding accounts for the 5px edge stripe so content doesn't overlap it. */
  padding-left: calc(var(--space-4) + 5px);
}

.task-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.task-title {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.3;
  word-break: break-all;
  overflow-wrap: anywhere;
  flex: 1;
}

/* Quieter status label — replaces the coloured StickerBadge (#116 one-accent rule) */
.task-status-label {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  opacity: 0.5;
  white-space: nowrap;
  padding-top: 2px;
}

/* Quality chips: year / resolution / codec / languages */
.task-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  background: var(--cream);
  border: var(--border-thin) solid var(--ink);
  border-radius: var(--radius);
  opacity: 0.75;
  white-space: nowrap;
}

.task-progress {
  /* bar stretches full-width of the card body */
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}

/* Bigger % per spec — this is the main number that needs to read at a glance */
.meta-pct {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  color: var(--ink);
  line-height: 1;
}

.meta-speed,
.meta-size {
  font-size: var(--fs-xs);
  color: var(--ink);
  opacity: 0.6;
}

.meta-dest {
  width: 100%;
  font-size: var(--fs-xs);
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Action row ── */
.task-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.btn-primary-action {
  flex: 1;
}

/* Overflow menu */
.overflow-wrapper {
  position: relative;
  flex-shrink: 0;
}

.btn-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 44px;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  color: var(--ink);
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  user-select: none;
  /* letter-spacing trick: "⋯" three-dot ellipsis */
  letter-spacing: -0.1em;
}

.overflow-menu {
  position: absolute;
  bottom: calc(100% + var(--space-1));
  right: 0;
  min-width: 160px;
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 10;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-3);
  min-height: 44px;
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--ink);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--cream);
  outline: none;
}
.menu-item-danger {
  color: var(--red);
}
.menu-item-icon {
  font-size: var(--fs-md);
}

/* Invisible backdrop to dismiss open menu on outside click */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9;
}

/* ── Delete confirmation dialog ── */
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(9, 9, 11, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: var(--space-4);
}

.confirm-dialog {
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-5);
  max-width: 320px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.confirm-message {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

/* ── Overflow menu pop animation ── */
.menu-pop-enter-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.menu-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-in),
    transform var(--dur-fast) var(--ease-in);
}
.menu-pop-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(4px);
}
.menu-pop-leave-to {
  opacity: 0;
  transform: scale(0.9) translateY(4px);
}

/* ── Confirm dialog pop ── */
.confirm-pop-enter-active {
  transition: opacity var(--dur-enter) var(--ease-out);
}
.confirm-pop-leave-active {
  transition: opacity var(--dur-exit) var(--ease-in);
}
.confirm-pop-enter-from,
.confirm-pop-leave-to {
  opacity: 0;
}

/*
 * Task list TransitionGroup (FLIP-capable).
 * Enter: ease-out slide-up + fade, staggered by --stagger-index.
 * Leave: ease-in slide-down + fade, shorter duration (--dur-list-leave).
 * Move (FLIP reorder): smooth translate via --dur-enter ease-out.
 * transform/opacity only — no layout thrashing.
 */
.task-list-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
  transition-delay: calc(var(--stagger-index, 0) * var(--stagger-step));
}
.task-list-leave-active {
  transition:
    opacity var(--dur-list-leave) var(--ease-in),
    transform var(--dur-list-leave) var(--ease-in);
  /* Leaving items must not participate in FLIP layout — pull out of flow. */
  position: absolute;
  width: 100%;
}
.task-list-move {
  transition: transform var(--dur-enter) var(--ease-out);
}
.task-list-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.task-list-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/*
 * ── Skeleton loader — Variant A (#115) ───────────────────────────────────────
 *
 * Content-shaped cards that mirror the real download card geometry (#116):
 * same border / radius / shadow / left edge stripe.  Animated via a horizontal
 * left→right shimmer sweep on the skeleton colour (background-position only,
 * no layout thrash).  Only renders on first load (loading && tasks.length===0).
 *
 * Skeleton palette:
 *   --sk-base   the quiet fill  (#e9e4d4 — warm parchment, no hue association)
 *   --sk-sheen  the shimmer peak (a lighter warm tone blended inline)
 *
 * Reduced motion: the global tokens.css block already sets
 *   animation-duration: 0.01ms; animation-iteration-count: 1
 * on * which effectively stops the shimmer.  The local override below
 * additionally freezes background-position so there is truly no movement.
 */
.loading-state {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Outer card — same geometry as the real Card component (raised tier) */
.sk-card {
  position: relative;
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-4);
  /* Left padding accounts for the 5px edge stripe (mirrors .task-card) */
  padding-left: calc(var(--space-4) + 5px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow: hidden;
}

/* Neutral skeleton grey edge stripe — left side, same position as Card::after stripe */
.sk-edge {
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  border-radius: var(--radius) 0 0 var(--radius);
  background: #e2ddd1; /* neutral skeleton grey — no status hue */
}

/* Shimmer keyframe: left → right sweep using background-position */
@keyframes sk-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

/*
 * Shimmer base: applied to every skeleton placeholder element.
 * The gradient blends skeleton-base → lighter sheen → skeleton-base,
 * which slides across via background-position.
 */
.sk-line,
.sk-chip {
  --sk-base: #e9e4d4;
  --sk-sheen: #f3eedf;
  border-radius: 6px;
  background: var(--sk-base);
  background-image: linear-gradient(
    90deg,
    var(--sk-base) 0,
    var(--sk-sheen) 40px,
    var(--sk-base) 80px
  );
  background-size: 300px 100%;
  background-repeat: no-repeat;
  animation: sk-shimmer 1.3s linear infinite;
}

/* Header row: title bar + status label placeholder */
.sk-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}

.sk-title {
  height: 16px;
  width: 62%;
}

.sk-label {
  height: 12px;
  width: 34px;
  flex-shrink: 0;
}

/* Chip row */
.sk-chips {
  display: flex;
  gap: var(--space-1);
}

.sk-chip {
  width: 42px;
  height: 18px;
  border-radius: 999px; /* fully-rounded pill like real chips */
}

/* Progress bar — full-width container (bordered, like ProgressBar), partial fill block */
.sk-bar {
  height: 18px;
  border: var(--border);
  border-radius: 6px;
  background: var(--paper);
  overflow: hidden;
}

.sk-bar-fill {
  --sk-base: #e9e4d4;
  --sk-sheen: #f3eedf;
  height: 100%;
  background: var(--sk-base);
  background-image: linear-gradient(
    90deg,
    var(--sk-base) 0,
    var(--sk-sheen) 40px,
    var(--sk-base) 80px
  );
  background-size: 300px 100%;
  background-repeat: no-repeat;
  animation: sk-shimmer 1.3s linear infinite;
}

/* Meta line */
.sk-meta {
  height: 12px;
  width: 45%;
}

/* Reduced motion: neutralise the shimmer sweep — fall back to a static tint. */
@media (prefers-reduced-motion: reduce) {
  .sk-line,
  .sk-chip,
  .sk-bar-fill {
    animation: none;
    background-image: none; /* remove the gradient; flat skeleton colour only */
  }
}
</style>
