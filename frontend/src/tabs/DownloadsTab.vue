<script setup lang="ts">
// Downloads tab — live task list with pause/resume/delete actions.
// Composed from the shared kit (Card, StickerBadge, ProgressBar, EmptyState)
// and driven by useTasks (polls every 3 s, no Pinia). Slice #61.
import Card from '../components/Card.vue'
import StickerBadge from '../components/StickerBadge.vue'
import ProgressBar from '../components/ProgressBar.vue'
import EmptyState from '../components/EmptyState.vue'
import { useTasks } from '../composables/useTasks'
import { formatBytes, formatSpeed } from '../format'
import type { Tone } from '../components/tones'

const { tasks, loading, error, pause, resume, delete: deleteTask } = useTasks()

type BadgeInfo = { text: string; tone: Tone }

function badgeForStatus(status: string): BadgeInfo {
  switch (status) {
    case 'downloading':
    case 'finishing':
    case 'waiting':
      return { text: 'DL', tone: 'violet' }
    case 'paused':
      return { text: 'PAUSE', tone: 'orange' }
    case 'finished':
    case 'seeding':
      return { text: 'DONE', tone: 'green' }
    case 'error':
      return { text: 'ERR', tone: 'red' }
    default:
      return { text: status, tone: 'default' }
  }
}

function progressToneForStatus(status: string): Tone {
  switch (status) {
    case 'finished':
    case 'seeding':
      return 'green'
    case 'paused':
      return 'orange'
    case 'error':
      return 'red'
    default:
      return 'violet'
  }
}

function cardToneForStatus(status: string): Tone {
  switch (status) {
    case 'error':
      return 'red'
    case 'paused':
      return 'orange'
    case 'finished':
    case 'seeding':
      return 'green'
    case 'downloading':
    case 'finishing':
    case 'waiting':
      return 'violet'
    default:
      return 'default'
  }
}

function isActive(status: string): boolean {
  return status === 'downloading' || status === 'waiting' || status === 'finishing'
}

function isPaused(status: string): boolean {
  return status === 'paused'
}

async function onPause(id: string): Promise<void> {
  await pause(id)
}

async function onResume(id: string): Promise<void> {
  await resume(id)
}

async function onDelete(id: string): Promise<void> {
  await deleteTask(id)
}
</script>

<template>
  <div class="downloads-tab">
    <!-- Loading skeleton -->
    <div v-if="loading && tasks.length === 0" class="loading-state" aria-label="Loading downloads">
      <div v-for="i in 2" :key="i" class="skeleton-card" />
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
        :tone="cardToneForStatus(task.status)"
        class="task-card"
        :style="{ '--stagger-index': index }"
      >
        <!-- Header row: title + badge -->
        <div class="task-header">
          <h3 class="task-title">{{ task.title }}</h3>
          <!-- Keyed <Transition> so a status change (DL→DONE→PAUSED) pops the badge. -->
          <Transition name="badge-pop" mode="out-in">
            <StickerBadge
              :key="badgeForStatus(task.status).text"
              :tone="badgeForStatus(task.status).tone"
              :rotate="-2"
            >{{ badgeForStatus(task.status).text }}</StickerBadge>
          </Transition>
        </div>

        <!-- Progress bar -->
        <div class="task-progress">
          <ProgressBar
            :value="task.pct"
            :tone="progressToneForStatus(task.status)"
            hide-label
          />
        </div>

        <!-- Meta row -->
        <div class="task-meta">
          <span class="meta-pct">{{ task.pct }}%</span>
          <span class="meta-speed">{{ formatSpeed(task.speedBytesPerSec) }}</span>
          <span class="meta-size">
            {{ formatBytes(task.downloadedBytes) }} / {{ formatBytes(task.sizeBytes) }}
          </span>
          <span v-if="task.destination" class="meta-dest">{{ task.destination }}</span>
        </div>

        <!-- Action buttons -->
        <div class="task-actions">
          <button
            v-if="isActive(task.status)"
            class="btn btn-pause"
            @click="onPause(task.id)"
          >Pause</button>

          <button
            v-if="isPaused(task.status)"
            class="btn btn-resume"
            @click="onResume(task.id)"
          >Resume</button>

          <button
            class="btn btn-delete"
            @click="onDelete(task.id)"
          >Delete</button>
        </div>
      </Card>
    </TransitionGroup>
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

.task-progress {
  /* Let the bar stretch full-width of the card body */
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--ink);
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.meta-pct {
  font-weight: var(--fw-bold);
  opacity: 1;
  color: var(--ink);
}

.meta-dest {
  width: 100%;
  font-size: var(--fs-xs);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Action buttons: Neo-Brutalism mechanical press style */
.task-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  border: var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  /* Hard offset shadow + mechanical press */
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
  user-select: none;
}

.btn:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}

.btn-pause {
  background: var(--yellow);
}

.btn-resume {
  background: var(--green);
}

.btn-delete {
  background: var(--red);
}

/*
 * Status-badge pop when DL→DONE→PAUSED→ERR changes.
 * out-in mode: old badge scales down + fades out, new one springs in.
 */
.badge-pop-enter-active {
  transition:
    opacity var(--dur-badge-pop) var(--ease-pop),
    transform var(--dur-badge-pop) var(--ease-pop);
}
.badge-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-in),
    transform var(--dur-fast) var(--ease-in);
}
.badge-pop-enter-from {
  opacity: 0;
  transform: rotate(-2deg) scale(0.7);
}
.badge-pop-leave-to {
  opacity: 0;
  transform: rotate(-2deg) scale(0.8);
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

/* Skeleton loading cards */
.skeleton-card {
  height: 140px;
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  opacity: 0.5;
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.25; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-card {
    animation: none;
  }
}
</style>
