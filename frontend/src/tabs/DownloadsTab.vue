<script setup lang="ts">
// Downloads tab — Variant B card redesign (#116).
//
// Visual spec:
//   • ONE status accent per card: a thin LEFT EDGE STRIPE (via Card edgeStripe
//     prop). Top tone strip + StickerBadge removed from card face.
//   • EXACTLY ONE primary action per card, status-dependent:
//       downloading / waiting / finishing → «Пауза» (primary/yellow)
//       paused                           → «Продолжить» (primary/yellow)
//       finished / seeding / error       → no primary; just the delete action
//   • Delete is a direct trash-icon button (no overflow ⋯ menu): one tap opens
//     the confirmation dialog. The old ⋯ menu only ever held Delete, so the
//     extra reveal step was pure indirection and has been removed.
//   • Quality chips (year / resolution / codec / languages) from #117 under title.
//   • Bigger % readout, quieter meta.
//   • Elevation tiers (#101 D) preserved: active+error → raised, settled → flat.
import { ref, computed, watch } from 'vue'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Chip from '../components/ui/Chip.vue'
import ScreenHeader from '../components/ui/ScreenHeader.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Spinner from '../components/ui/Spinner.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { useTasks } from '../composables/useTasks'
import { useOptimisticTasks } from '../composables/useOptimisticTasks'
import { formatBytes, formatSpeed } from '../format'
import type { Tone } from '../components/ui/tones'
import type { TaskView } from '../types'

// Callback to open the Add wizard — provided by App.vue via #249 (restored from d635453).
// Optional so DownloadsTab can still be mounted in tests without wiring.
const props = withDefaults(defineProps<{ onAddClick?: () => void }>(), {
  onAddClick: undefined,
})

const { tasks, loading, error, pause, resume, delete: deleteTask } = useTasks()

// Optimistic placeholders (added by AddFlow on «Добавить») render as their own
// loader cards ABOVE the real list so a download appears the instant the sheet
// closes. They live in a SEPARATE list from the real-task cards on purpose: the
// real-task TransitionGroup stays byte-identical to before, and `pending` is
// empty in steady state. We retire them as the polled list updates (reconcile is
// a no-op while there are none, so it adds zero churn).
const { pendingTasks, reconcile } = useOptimisticTasks()
const pending = computed(() => pendingTasks())
watch(tasks, (real) => reconcile(real))

// ── Delete confirmation state ────────────────────────────────────────────────
// Task pending delete confirmation (set by the trash-icon button, cleared on
// cancel/confirm). The dialog is the only guard before the destructive action.
const confirmDeleteId = ref<string | null>(null)

// Task whose delete is in-flight (#269 task 10). While set, the confirm dialog
// shows a «Удаляю…» loader with the buttons gone, and stays open until the API
// resolves — the task then leaves the list on the refetch. Without this the
// dialog closed instantly and the card sat there for the 5–10 s the delete took.
const deletingId = ref<string | null>(null)

function requestDelete(id: string): void {
  confirmDeleteId.value = id
}

function cancelDelete(): void {
  // Can't dismiss mid-delete — the action is already committed.
  if (deletingId.value !== null) return
  confirmDeleteId.value = null
}

async function confirmDelete(): Promise<void> {
  if (!confirmDeleteId.value || deletingId.value !== null) return
  const id = confirmDeleteId.value
  deletingId.value = id
  try {
    await deleteTask(id)
  } finally {
    deletingId.value = null
    confirmDeleteId.value = null
  }
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
    case 'hash_checking': return 'Проверка'
    case 'extracting':  return 'Распаковка'
    case 'waiting':     return 'Ожидание'
    case 'filehosting_waiting': return 'Ожидание'
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
    <ScreenHeader title="Загрузки" />

    <!-- Loading skeleton: content-shaped cards matching the real card geometry (#115 Variant A).
         Suppressed while an optimistic placeholder is pending so a just-added download shows its
         «Добавляем…» card immediately instead of the skeleton/empty screen (#269 task 09). -->
    <div v-if="loading && tasks.length === 0 && pending.length === 0" class="loading-state" aria-label="Загрузка списка" aria-busy="true">
      <div v-for="i in 3" :key="i" class="sk-card" role="presentation">
        <!-- Left edge stripe in neutral skeleton grey (status unknown while loading) -->
        <div class="sk-edge" />
        <!-- Title row: ~60% title bar + small status label placeholder -->
        <div class="sk-row">
          <Skeleton class="sk-title" />
          <Skeleton class="sk-label" />
        </div>
        <!-- Quality chip placeholders (year / resolution / codec) -->
        <div class="sk-chips">
          <Skeleton class="sk-chip" />
          <Skeleton class="sk-chip" />
          <Skeleton v-if="i !== 2" class="sk-chip" />
        </div>
        <!-- Progress bar placeholder (full-width container + partial fill block) -->
        <div class="sk-bar">
          <Skeleton class="sk-bar-fill" :style="{ width: i === 1 ? '55%' : '78%' }" />
        </div>
        <!-- Meta line placeholder -->
        <div class="sk-row">
          <Skeleton class="sk-meta" />
        </div>
      </div>
    </div>

    <!-- Error state -->
    <EmptyState v-else-if="error" title="Ошибка" :message="error">
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </template>
    </EmptyState>

    <!-- Empty state: inline add-row as the Add affordance (#249). Also suppressed
         while a placeholder is pending (#269 task 09) — the just-added download
         renders in the list below instead of flashing «Нет загрузок». -->
    <EmptyState v-else-if="!loading && tasks.length === 0 && pending.length === 0" title="Нет загрузок" message="Добавьте торрент, чтобы начать.">
      <template #action>
        <button
          type="button"
          class="add-row nb-pressable"
          data-testid="add-row"
          @click="props.onAddClick?.()"
        >
          <span class="add-row-chip" aria-hidden="true">+</span>
          <span class="add-row-label">Добавить загрузку</span>
        </button>
      </template>
    </EmptyState>

    <!-- Task list: inline add-row is the Add affordance (#249, restored from d635453). -->
    <TransitionGroup v-else tag="div" name="task-list" class="task-list" appear>
      <!-- Inline «Добавить загрузку» row — always the first item, scrolls with the list -->
      <button
        key="__add-row__"
        type="button"
        class="add-row nb-pressable"
        data-testid="add-row"
        @click="props.onAddClick?.()"
      >
        <span class="add-row-chip" aria-hidden="true">+</span>
        <span class="add-row-label">Добавить загрузку</span>
      </button>

      <!-- Optimistic placeholders (#instant-add): a loader card per just-added
           download, shown the moment the Add sheet closes and retired when the
           real task lands on a poll. Empty in steady state — leaves the real-task
           list below untouched. -->
      <Card
        v-for="p in pending"
        :key="p.id"
        edge-stripe="violet"
        variant="raised"
        class="task-card"
        :data-testid="`pending-${p.id}`"
      >
        <div class="task-header">
          <h3 class="task-title">{{ p.title }}</h3>
          <span class="task-status-label">Добавление…</span>
        </div>
        <div class="task-pending">
          <Spinner :size="18" aria-hidden="true" />
          <span class="task-pending-text">Добавляем на NAS…</span>
        </div>
        <div v-if="p.destination" class="task-meta">
          <span class="meta-dest">{{ p.destination }}</span>
        </div>
      </Card>

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
          <Chip v-for="chip in qualityChips(task)" :key="chip" variant="tag">{{ chip }}</Chip>
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

        <!-- Action row: pause/resume + delete as ONE right-aligned segmented
             group (#267 task 01) — instead of pause far-left / delete far-right. -->
        <div class="task-actions">
          <div class="action-group">
            <!-- Primary action: icon-only pause/resume. Pause glyph while
                 downloading/waiting/finishing; play glyph while paused. -->
            <button
              v-if="hasPrimaryAction(task.status)"
              type="button"
              class="action-seg action-seg--primary"
              :aria-label="isPaused(task.status) ? 'Продолжить' : 'Пауза'"
              :data-testid="`btn-primary-${task.id}`"
              :disabled="deletingId === task.id"
              @click="onPrimary(task)"
            >
              <!-- Pause glyph: two vertical bars -->
              <svg v-if="!isPaused(task.status)" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              <!-- Play/resume glyph: right-pointing triangle -->
              <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </button>

            <!-- Delete: one tap opens the confirm dialog. -->
            <button
              type="button"
              class="action-seg action-seg--delete"
              :aria-label="`Удалить: ${task.title}`"
              :data-testid="`btn-delete-${task.id}`"
              :disabled="deletingId === task.id"
              @click.stop="requestDelete(task.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        </div>
      </Card>
    </TransitionGroup>

    <!-- Delete confirmation dialog (destructive — kept per spec) -->
    <Teleport to="body">
      <Transition name="confirm-pop">
        <div v-if="confirmDeleteId !== null" class="confirm-backdrop" @click.self="cancelDelete">
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="Confirm delete">
            <p class="confirm-message">
              {{ deletingId !== null ? 'Удаляю задачу…' : 'Удалить задачу? Это действие нельзя отменить.' }}
            </p>
            <!-- While the delete is in-flight: a loader replaces the buttons and the
                 dialog stays open until the task actually leaves the list (#269 task 10). -->
            <div v-if="deletingId !== null" class="confirm-deleting" data-testid="delete-progress" aria-live="polite">
              <Spinner :size="18" aria-hidden="true" />
              <span>Удаляю…</span>
            </div>
            <div v-else class="confirm-actions">
              <Button variant="neutral" size="sm" data-testid="btn-cancel-delete" @click="cancelDelete">Отмена</Button>
              <Button variant="danger" size="sm" data-testid="btn-confirm-delete" @click="confirmDelete">Удалить</Button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.downloads-tab {
  padding: var(--space-4);
  /* No bottom tab bar anymore (ADR 0015): the shell owns the safe-area clearance. */
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

/* ── Optimistic (pending) placeholder loader (#instant-add) ── */
.task-pending {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.task-pending-text {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  opacity: 0.75;
}

/* ── Action row ── */
/* The actions read as ONE right-aligned segmented control (#267 task 01) rather
   than pause-far-left / delete-far-right split across the card width. */
.task-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

/* Segmented group: shared strong border + offset shadow, hairline divider between
   the (optional) pause/resume segment and the delete segment. */
.action-group {
  display: inline-flex;
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.action-seg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 52px;
  min-height: 44px;
  color: var(--ink);
  background: var(--cream);
  border: none;
  border-radius: 0;
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-fast) var(--ease-out);
}
/* Divider between segments — the only internal line of the group. */
.action-seg + .action-seg {
  border-left: var(--border-strong);
}
.action-seg:active {
  background: var(--ink-active);
}
.action-seg:disabled {
  opacity: 0.5;
  cursor: default;
}
.action-seg svg {
  width: 20px;
  height: 20px;
}

/* Pause/resume segment carries the yellow action accent. */
.action-seg--primary {
  background: var(--yellow);
}
.action-seg--primary:active {
  background: var(--yellow);
  filter: brightness(0.92);
}

/* ── Delete confirmation dialog ── */
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: var(--scrim);
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

/* In-flight delete loader (#269 task 10) — replaces the buttons while awaiting. */
.confirm-deleting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
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
 * same border / radius / shadow / left edge stripe.  Shimmer animation is
 * delegated to the <Skeleton> primitive (components/ui/Skeleton.vue) which
 * owns the keyframe + token-based gradient.  Only the structural layout and
 * sizing classes remain here.  Only renders on first load
 * (loading && tasks.length===0).
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
  background: var(--sk-edge); /* neutral skeleton grey — no status hue */
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
  border-radius: var(--radius-pill); /* fully-rounded pill like real chips */
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
  height: 100%;
}

/* Meta line */
.sk-meta {
  height: 12px;
  width: 45%;
}

/*
 * ── Inline «Добавить загрузку» add row (#249, restored from d635453) ──────────
 *
 * Neo-Brutalism: thick dashed ink border, yellow «+» chip, mechanical press.
 * Full-width, min-height 56px (>= 44px touch target with visual breathing room).
 * Scrolls with the list — not fixed/floating.
 * Appears as the first item in both the task list AND the empty state action slot.
 */
.add-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
  background: var(--paper);
  border: 3px dashed var(--ink);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: var(--font);
  color: var(--ink);
  text-align: left;
  /* Mechanical press (neo-brutalism): sinks into an offset shadow */
  --press: 3px;
}

/* Yellow «+» chip — the sole accent colour per ADR 0006 addendum */
.add-row-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--yellow);
  border: var(--border-strong);
  border-radius: var(--radius);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  line-height: 1;
  flex-shrink: 0;
}

.add-row-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
