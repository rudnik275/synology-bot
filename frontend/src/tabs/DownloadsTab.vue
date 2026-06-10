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
//   • Delete is a two-tap INLINE confirm: tapping the trash button arms the card
//     and the action group morphs into [cancel ×][confirm ✓ (red)]; a second tap
//     on the confirm button issues the delete (spinner + disabled while in-flight),
//     then the card leaves the list on the refetch. No modal — the confirm lives in
//     the action group itself.
//   • Quality chips (year / resolution / codec / languages) from #117 under title.
//   • Bigger % readout, quieter meta.
//   • Elevation tiers (#101 D) preserved: active+error → raised, settled → flat.
import { ref, computed, watch } from 'vue'
import Card from '../components/ui/Card.vue'
import Chip from '../components/ui/Chip.vue'
import ScreenHeader from '../components/ui/ScreenHeader.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Spinner from '../components/ui/Spinner.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { useTasks } from '../composables/useTasks'
import { useOptimisticTasks } from '../composables/useOptimisticTasks'
import type { PendingTaskView } from '../composables/useOptimisticTasks'
import { useAddFailures } from '../composables/useAddFailures'
import { formatBytes, formatSpeed } from '../format'
import type { Tone } from '../components/ui/tones'
import type { TaskView } from '../types'

// Callback to open the Add wizard — provided by App.vue via #249 (restored from d635453).
// Optional so DownloadsTab can still be mounted in tests without wiring.
const props = withDefaults(defineProps<{ onAddClick?: () => void }>(), {
  onAddClick: undefined,
})

const { tasks, loading, error, pause, resume, delete: deleteTask } = useTasks()

// Optimistic placeholders (added by AddFlow on «Добавить») render ABOVE the real
// list so a download appears the instant the sheet closes — through the SAME card
// template (see displayTasks below) so a just-added card is indistinguishable from
// a real just-started one. `pending` is empty in steady state; we retire entries
// as the polled list updates (reconcile is a no-op while there are none).
const { pendingTasks, reconcile, remove: removePending } = useOptimisticTasks()
const pending = computed(() => pendingTasks())
watch(tasks, (real) => reconcile(real))

// Failed adds (#288): when a background add rejects, AddFlow rolls the pending
// placeholder back AND records the failure here — rendered as a red «Ошибка
// добавления» card pinned above the list until dismissed, so a failed add never
// silently vanishes.
const { failures, dismiss: dismissFailure } = useAddFailures()

// One unified list: pending placeholders render ABOVE the real tasks through the
// SAME card template (status 'pending' → «Добавление…» label, violet stripe, 0%
// readout, delete-only action group). reconcile() keeps `pending` empty in steady
// state, so this is just `tasks` then.
const displayTasks = computed<PendingTaskView[]>(() => [...pending.value, ...tasks.value])

// ── Delete state ──────────────────────────────────────────────────────────────
// Two-tap inline confirm (round-3 feedback): tapping the trash button ARMS the
// card — the action group morphs into [cancel ×][confirm ✓ (red)]. A second tap on
// the confirm button issues the DELETE; the cancel button (or arming another card)
// backs out. This is the inline confirm the user asked for, WITHOUT the lingering
// modal that round-2 removed: the confirm lives in the card's own action group, and
// while the delete is in-flight the confirm button shows a spinner + is disabled.
const confirmingId = ref<string | null>(null) // the card currently armed for delete
const deletingId = ref<string | null>(null) // the card whose delete is in-flight
// Pending placeholders the user confirmed delete on BEFORE their real DSM id was
// known (the add request hadn't resolved yet). The watcher below fires the actual
// delete the instant attachRealId records the id — see cancelPending().
const awaitingRealIdToCancel = ref<Set<string>>(new Set())

/** First tap on the trash button: arm this card for delete (no API call yet). */
function armDelete(id: string): void {
  if (deletingId.value !== null) return
  confirmingId.value = id
}

/** Back out of the armed state without deleting. */
function cancelDelete(): void {
  confirmingId.value = null
}

/** Second tap (the confirm button): actually delete. */
async function onDelete(id: string): Promise<void> {
  if (deletingId.value !== null) return
  // A pending placeholder's id is an `optimistic-…` id — there is no backend task
  // to DELETE by it. Route it to the cancel path, which deletes the download by
  // its REAL DSM id (the add response echoed it; #pending-cancel).
  const placeholder = pending.value.find((p) => p.id === id)
  if (placeholder) {
    await cancelPending(placeholder)
    return
  }
  deletingId.value = id
  try {
    await deleteTask(id)
  } finally {
    deletingId.value = null
    confirmingId.value = null
  }
}

/**
 * Cancel a still-pending («Добавление…») download. If its real DSM id is already
 * known, delete it on the NAS now; otherwise mark it (spinner stays) and let the
 * watcher fire the delete the moment attachRealId records the id.
 */
async function cancelPending(p: PendingTaskView): Promise<void> {
  deletingId.value = p.id // spinner on the confirm button; the card stays armed
  if (p.realId) {
    await deleteRealAndDrop(p.id, p.realId)
  } else {
    awaitingRealIdToCancel.value.add(p.id)
  }
}

/** Delete the real task on the NAS, then drop the placeholder + reset delete UI. */
async function deleteRealAndDrop(optimisticId: string, realId: string): Promise<void> {
  try {
    await deleteTask(realId)
  } finally {
    removePending(optimisticId)
    awaitingRealIdToCancel.value.delete(optimisticId)
    if (deletingId.value === optimisticId) deletingId.value = null
    if (confirmingId.value === optimisticId) confirmingId.value = null
  }
}

// Resolve deferred cancels: when a placeholder the user already confirmed delete
// on finally gains its real id (attachRealId, just after the add resolves), delete
// it now. Also clears the delete-UI if the placeholder vanished first (add failed →
// removed, or the 30 s TTL swept it) so a spinner never sticks.
watch(pending, (list) => {
  if (awaitingRealIdToCancel.value.size === 0) return
  const present = new Set(list.map((p) => p.id))
  for (const p of list) {
    if (awaitingRealIdToCancel.value.has(p.id) && p.realId) {
      awaitingRealIdToCancel.value.delete(p.id) // guard against a double-fire
      void deleteRealAndDrop(p.id, p.realId)
    }
  }
  for (const id of [...awaitingRealIdToCancel.value]) {
    if (!present.has(id)) {
      awaitingRealIdToCancel.value.delete(id)
      if (deletingId.value === id) deletingId.value = null
      if (confirmingId.value === id) confirmingId.value = null
    }
  }
})

// ── Status helpers ────────────────────────────────────────────────────────────

/** Left-edge stripe tone — single accent for Variant B (#116). */
function stripeToneForStatus(status: string): Tone {
  switch (status) {
    case 'pending': // optimistic «Добавление…» placeholder — reads as queued/active
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

/** Elevation tier (#101 D): active + errors + pending stay raised; settled → flat. */
function cardVariantForStatus(status: string): 'flat' | 'raised' {
  return isActive(status) || status === 'error' || status === 'pending' ? 'raised' : 'flat'
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
    case 'pending':     return 'Добавление…'
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
    <div v-if="loading && tasks.length === 0 && pending.length === 0 && failures.length === 0" class="loading-state" aria-label="Загрузка списка" aria-busy="true">
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

    <!-- Error state — only when there are no tasks to show (mirrors NasTab's
         `error && !data` guard): an error with data already on screen must not
         blank the whole list. -->
    <EmptyState v-else-if="error && tasks.length === 0 && failures.length === 0" title="Ошибка" :message="error">
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
    <EmptyState v-else-if="!loading && tasks.length === 0 && pending.length === 0 && failures.length === 0" title="Нет загрузок" message="Добавьте торрент, чтобы начать.">
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

      <!-- Failed adds (#288): a background add that rejected. Red-striped card with
           the error message + a dismiss ✕; persists until dismissed (no TTL) so the
           failure is never silent. Pinned ABOVE pending placeholders + real tasks. -->
      <Card
        v-for="f in failures"
        :key="f.id"
        edge-stripe="red"
        variant="raised"
        class="task-card task-card--failed"
        :data-testid="`add-failed-${f.id}`"
      >
        <div class="task-header">
          <h3 class="task-title">{{ f.title }}</h3>
          <span class="task-status-label" :aria-label="'Status: Ошибка добавления'">Ошибка добавления</span>
        </div>
        <p class="failed-msg" data-testid="add-failed-msg">Не удалось добавить: {{ f.message }}</p>
        <div class="task-footer">
          <div class="task-meta">
            <span v-if="f.destination" class="meta-dest">{{ f.destination }}</span>
          </div>
          <div class="action-group nb-framed nb-pressable">
            <button
              type="button"
              class="action-seg"
              :aria-label="`Скрыть ошибку: ${f.title}`"
              :data-testid="`add-failed-dismiss-${f.id}`"
              @click.stop="dismissFailure(f.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </Card>

      <!-- Pending placeholders (#instant-add) render FIRST, through the same card
           template as real tasks: a just-added download shows the moment the Add
           sheet closes with a «Добавление…» status, an empty (0 %) bar, a 0 B / size
           readout and a working delete — and is retired when the real task lands on
           a poll. `displayTasks` is just `tasks` in steady state. -->
      <Card
        v-for="(task, index) in displayTasks"
        :key="task.id"
        :edge-stripe="stripeToneForStatus(task.status)"
        :variant="cardVariantForStatus(task.status)"
        class="task-card"
        :style="{ '--stagger-index': index }"
        :data-testid="task.status === 'pending' ? `pending-${task.id}` : undefined"
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

        <!-- Footer: meta + actions on ONE row to save vertical space (round-2). -->
        <div class="task-footer">
          <div class="task-meta">
            <span class="meta-pct">{{ task.pct }}%</span>
            <span v-if="isActive(task.status)" class="meta-speed">{{ formatSpeed(task.speedBytesPerSec) }}</span>
            <span class="meta-size">{{ formatBytes(task.downloadedBytes) }} / {{ formatBytes(task.sizeBytes) }}</span>
            <span v-if="task.destination" class="meta-dest">{{ task.destination }}</span>
          </div>

          <!-- pause/resume + delete as ONE segmented group, to the right of the meta.
               The whole group is .nb-pressable so a tap on either button sinks the
               group into its shadow (the «вдавливание» press feedback). -->
          <div class="action-group nb-framed nb-pressable" :class="{ 'action-group--armed': confirmingId === task.id }">
            <!-- ARMED: inline delete confirm — [cancel ×][confirm ✓ (red)]. -->
            <template v-if="confirmingId === task.id">
              <button
                type="button"
                class="action-seg action-seg--cancel"
                aria-label="Отмена"
                :data-testid="`btn-cancel-delete-${task.id}`"
                :disabled="deletingId === task.id"
                @click.stop="cancelDelete()"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                class="action-seg action-seg--confirm"
                :aria-label="`Подтвердить удаление: ${task.title}`"
                :data-testid="`btn-confirm-delete-${task.id}`"
                :disabled="deletingId === task.id"
                @click.stop="onDelete(task.id)"
              >
                <Spinner v-if="deletingId === task.id" :size="18" aria-hidden="true" />
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </template>

            <!-- DEFAULT: [pause/resume?][trash]. The trash button only ARMS — the
                 actual delete needs the confirm tap above. -->
            <template v-else>
              <!-- Primary action: icon-only pause/resume. -->
              <button
                v-if="hasPrimaryAction(task.status)"
                type="button"
                class="action-seg action-seg--primary"
                :aria-label="isPaused(task.status) ? 'Продолжить' : 'Пауза'"
                :data-testid="`btn-primary-${task.id}`"
                @click="onPrimary(task)"
              >
                <svg v-if="!isPaused(task.status)" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </button>

              <button
                type="button"
                class="action-seg action-seg--delete"
                :aria-label="`Удалить: ${task.title}`"
                :data-testid="`btn-delete-${task.id}`"
                @click.stop="armDelete(task.id)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </template>
          </div>
        </div>
      </Card>
    </TransitionGroup>
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
  /* The status edge is now the card's coloured 5px LEFT BORDER (Card.vue), so the
     content inset is just the normal gutter — the border occupies its own space. */
  padding-left: var(--space-4);
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

/* Failed-add card (#288): the error message line under the title. */
.failed-msg {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--ink);
  opacity: 0.75;
  overflow-wrap: anywhere;
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

/* Footer row: meta on the left, the action group on the right, on ONE line to
   save vertical space (round-2). The action group sits vertically centred. */
.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.task-footer .task-meta {
  flex: 1 1 auto;
  min-width: 0;
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

/* ── Action group (pause/resume + delete) ── */
/* ONE segmented control built on the shared .nb-framed preset (tokens.css): the
   5px black outline is an inset overlay over FULL-BLEED segments, so the coloured
   fills reach the rounded corners with no cream sliver — and the layer promotion
   in .nb-framed makes the iOS WebView clip the segments' :active repaint to the
   rounded corners reliably (the leak that the old per-segment-radius hack fought
   by abandoning the clip altogether). Only the offset shadow lives here now. */
.action-group {
  display: inline-flex;
  flex-shrink: 0;
  --nb-frame-w: var(--border-thick);
  box-shadow: var(--shadow-sm);
  /* Press follows the shadow offset (--shadow-sm = 3px) so the group sinks
     exactly into its own shadow on tap. */
  --press: var(--border-thin);
}

.action-seg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* A touch wider + taller than before so the icon has room and reads centred
     (round-3). The first/last paddings below re-centre the icon inside the
     VISIBLE interior, compensating the 5px inset .nb-framed outline that overlays
     the group's outer edges. */
  width: 56px;
  min-height: 46px;
  color: var(--ink);
  background: var(--cream);
  border: none;
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-fast) var(--ease-out);
}
/* Centre the icon within the visible interior: the inset frame overlays 5px on
   the group's outer edges, so the outermost segments gain matching padding there
   so the icon does not read as shifted toward the frame. */
.action-seg:first-child {
  padding-left: var(--border-thick);
}
.action-seg:last-child {
  padding-right: var(--border-thick);
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

/* ── Inline delete confirm (round-3): armed group = [cancel ×][confirm ✓ red] ──
   The confirm carries the red destructive accent so the second tap reads as the
   point of no return; cancel stays the quiet cream segment. */
.action-seg--confirm {
  background: var(--red);
  color: var(--paper);
}
.action-seg--confirm:active {
  background: var(--red);
  filter: brightness(0.92);
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
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow: hidden;
}

/* Neutral skeleton grey edge stripe — mirrors the real Card::after stripe: a
   coloured (here: neutral grey) bar framed in black, the card's own border on
   three sides + this bar's border-right drawing the inner black line. */
.sk-edge {
  position: absolute;
  inset: 0 auto 0 0;
  width: 6px;
  border-right: var(--border-thin) solid var(--ink);
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

/* Yellow «+» chip — the sole accent colour per ADR 0006 addendum.
   At 28px the 5px border + 12px radius read as a heavy "neither round nor square"
   blob (round-3 feedback), so the chip uses the thin 3px border + a smaller 8px
   radius: a crisp, clearly-rounded square sized to the small button. */
.add-row-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--yellow);
  border: var(--border);
  border-radius: 8px;
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
