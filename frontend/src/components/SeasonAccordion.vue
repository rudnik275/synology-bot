<script setup lang="ts">
import { ref } from 'vue'
import type { ShowSeasonView } from '../types'

const props = defineProps<{
  seasons: ShowSeasonView[]
  /** Index of the season to expand initially (latest = last element). Defaults to last season. */
  defaultOpenIndex?: number
}>()

const effectiveDefault = props.defaultOpenIndex ?? (props.seasons.length > 0 ? props.seasons.length - 1 : 0)
const openIndex = ref<number>(effectiveDefault)

function toggle(index: number): void {
  openIndex.value = openIndex.value === index ? -1 : index
}

function formatDate(airDate: string | null): string {
  if (!airDate) return '—'
  const d = new Date(airDate)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function padNum(n: number): string {
  return String(n).padStart(2, '0')
}
</script>

<template>
  <div class="season-accordion">
    <div
      v-for="(season, index) in seasons"
      :key="season.season"
      class="season-block"
    >
      <button
        class="season-header"
        :aria-expanded="openIndex === index"
        :data-testid="`season-header-${season.season}`"
        @click="toggle(index)"
      >
        <span class="season-label">Сезон {{ season.season }}</span>
        <span class="season-count">{{ season.episodes.length }} эп.</span>
        <svg
          class="chevron"
          :class="{ 'chevron--open': openIndex === index }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div v-if="openIndex === index" class="episode-list">
        <div
          v-for="ep in season.episodes"
          :key="ep.episode"
          class="episode-row"
          :class="{ 'episode-row--aired': ep.aired, 'episode-row--upcoming': !ep.aired }"
        >
          <span class="ep-code">S{{ padNum(season.season) }}E{{ padNum(ep.episode) }}</span>
          <span class="ep-title">{{ ep.title }}</span>
          <span class="ep-date">{{ formatDate(ep.airDate) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.season-accordion {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.season-block {
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--paper);
}

.season-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  color: var(--ink);
  text-align: left;
}

.season-label {
  flex: 1 1 auto;
}

.season-count {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  opacity: 0.6;
  white-space: nowrap;
}

.chevron {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.chevron--open {
  transform: rotate(180deg);
}

.episode-list {
  display: flex;
  flex-direction: column;
  border-top: var(--border);
}

.episode-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  font-size: var(--fs-sm);
}

.episode-row:last-child {
  border-bottom: none;
}

.episode-row--upcoming {
  opacity: 0.55;
}

.ep-code {
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-bold);
  font-size: var(--fs-xs);
  white-space: nowrap;
  min-width: 4.5em;
}

.ep-title {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-date {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
  opacity: 0.7;
  white-space: nowrap;
}
</style>
