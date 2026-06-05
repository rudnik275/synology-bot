<script setup lang="ts">
import { computed } from 'vue'
import type { ShowDetailView } from '../types'
import { deriveLastAired, deriveNextEpisode } from '../composables/useShowDetail'
import SeasonAccordion from './SeasonAccordion.vue'
import Button from './ui/Button.vue'
import EmptyState from './ui/EmptyState.vue'
import Skeleton from './ui/Skeleton.vue'

const props = defineProps<{
  show?: ShowDetailView | null
  /** While show===null and loading===true the first-load skeleton is shown. */
  loading?: boolean
  subscribing?: boolean
}>()

const emit = defineEmits<{
  subscribe: []
  unsubscribe: []
}>()

// ── Episode derivation ──────────────────────────────────────────────────────
// latestAiredEpisode is NOT carried on ShowDetailView (it lives on SubscriptionView).
// We derive it from the seasons array as the fallback path.
const lastAired = computed(() =>
  props.show ? deriveLastAired(props.show.seasons, null) : null,
)

const nextEpisode = computed(() =>
  props.show ? deriveNextEpisode(props.show.seasons) : null,
)

// ── Helpers ─────────────────────────────────────────────────────────────────
function padNum(n: number): string {
  return String(n).padStart(2, '0')
}

function epCode(season: number, episode: number): string {
  return `S${padNum(season)}E${padNum(episode)}`
}

function formatDate(airDate: string): string {
  const d = new Date(airDate)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
</script>

<template>
  <!-- ── First-load skeleton ──────────────────────────────────────────────── -->
  <div v-if="loading && !show" class="show-detail" aria-busy="true" aria-label="Загрузка">
    <!-- Row 1: thumbnail + title -->
    <div class="show-hero">
      <Skeleton class="sk-thumb" />
      <div class="show-titles sk-titles">
        <Skeleton class="sk-title" />
        <Skeleton class="sk-title-orig" />
        <Skeleton class="sk-btn" />
      </div>
    </div>

    <!-- Row 2: two status cards -->
    <div class="status-row">
      <Skeleton class="sk-status-card" />
      <Skeleton class="sk-status-card" />
    </div>

    <!-- Row 3: description block -->
    <Skeleton class="sk-description" />

    <!-- Row 4: season rows -->
    <div class="sk-seasons">
      <Skeleton class="sk-season-row" />
      <Skeleton class="sk-season-row" />
      <Skeleton class="sk-season-row" />
    </div>
  </div>

  <!-- ── Loaded state ─────────────────────────────────────────────────────── -->
  <div v-else-if="show" class="show-detail">
    <!-- Block 1: thumbnail + titles + «Отписаться» button ─────────────────── -->
    <div class="show-hero">
      <img
        v-if="show.poster"
        :src="show.poster"
        :alt="show.title"
        class="show-thumb"
      />
      <div
        v-else
        class="show-thumb show-thumb-placeholder"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </div>

      <div class="show-titles">
        <h1 class="show-title">{{ show.title }}</h1>
        <p v-if="show.titleOriginal" class="show-title-original">{{ show.titleOriginal }}</p>

        <!-- Unsubscribe / Subscribe button lives in the title row (right-aligned) -->
        <div class="show-action">
          <Button
            v-if="show.isSubscribed"
            data-testid="unsubscribe-btn"
            variant="danger"
            size="sm"
            :disabled="subscribing"
            @click="emit('unsubscribe')"
          >
            {{ subscribing ? 'Отписка…' : 'Отписаться' }}
          </Button>
          <Button
            v-else
            data-testid="subscribe-btn"
            variant="primary"
            size="sm"
            :disabled="subscribing"
            @click="emit('subscribe')"
          >
            {{ subscribing ? 'Подписка…' : 'Подписаться' }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Block 2: status cards side-by-side ──────────────────────────────── -->
    <div class="status-row">
      <!-- «Вышла» — last aired -->
      <div class="status-card status-card--aired">
        <span class="status-label">Вышла</span>
        <template v-if="lastAired">
          <span class="status-code" data-testid="last-aired-code">
            {{ epCode(lastAired.season, lastAired.episode) }}
          </span>
          <span class="status-date" data-testid="last-aired-date">
            {{ formatDate(lastAired.airDate) }}
          </span>
        </template>
        <span v-else class="status-empty" data-testid="last-aired-empty">—</span>
      </div>

      <!-- «Следующая» — next episode (yellow) -->
      <div class="status-card status-card--next">
        <span class="status-label">Следующая</span>
        <template v-if="nextEpisode">
          <span class="status-code" data-testid="next-episode-code">
            {{ epCode(nextEpisode.season, nextEpisode.episode) }}
          </span>
          <span class="status-date" data-testid="next-episode-date">
            {{ formatDate(nextEpisode.airDate) }}
          </span>
        </template>
        <span v-else class="status-empty" data-testid="next-episode-empty">—</span>
      </div>
    </div>

    <!-- Block 3: «Описание» — inline section (no dropdown) ──────────────── -->
    <section v-if="show.description" class="description-section">
      <h2 class="section-title">Описание</h2>
      <p class="show-description">{{ show.description }}</p>
    </section>

    <!-- Block 4: «Сезоны» accordion ─────────────────────────────────────── -->
    <section v-if="show.seasons.length > 0" class="seasons-section">
      <h2 class="section-title">Сезоны</h2>
      <SeasonAccordion :seasons="show.seasons" />
    </section>

    <EmptyState
      v-else
      title="Нет эпизодов"
      message="Эпизоды не найдены."
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.show-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-4);
}

/* ── Block 1: title row ──────────────────────────────────────────────────── */
.show-hero {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

/* Hero poster: 2:3 ratio, block treatment */
.show-thumb {
  width: 128px;
  height: 192px;
  object-fit: cover;
  border-radius: var(--radius);
  border: var(--border);
  box-shadow: var(--shadow-md);
  flex-shrink: 0;
}

.show-thumb-placeholder {
  background: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
}

.show-thumb-placeholder svg {
  width: 28px;
  height: 28px;
}

.show-titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.show-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  line-height: 1.2;
}

.show-title-original {
  margin: 0;
  font-size: var(--fs-xs);
  opacity: 0.6;
  font-style: italic;
}

.show-action {
  margin-top: var(--space-2);
}

/* ── Block 2: status cards ───────────────────────────────────────────────── */
.status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.status-card {
  border: var(--border);
  border-radius: var(--radius);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  background: var(--paper);
  box-shadow: var(--shadow-sm);
}

.status-card--next {
  background: var(--yellow);
}

.status-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.65;
}

.status-code {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.status-date {
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.status-empty {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  opacity: 0.4;
}

/* ── Block 3: seasons ────────────────────────────────────────────────────── */
.section-title {
  margin: 0 0 var(--space-2) 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink);
}

.seasons-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ── Block 3: description (inline section) ──────────────────────────────── */
.description-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.show-description {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  opacity: 0.85;
}

/* ── Skeleton shapes ─────────────────────────────────────────────────────── */
.sk-thumb {
  width: 128px;
  height: 192px;
  flex-shrink: 0;
}

.sk-titles {
  gap: var(--space-2);
}

.sk-title {
  height: 20px;
  width: 80%;
}

.sk-title-orig {
  height: 14px;
  width: 55%;
}

.sk-btn {
  height: 36px;
  width: 100px;
  margin-top: var(--space-1);
}

.sk-status-card {
  height: 80px;
  border-radius: var(--radius);
}

.sk-seasons {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sk-season-row {
  height: 48px;
  border-radius: var(--radius);
}

.sk-description {
  height: 48px;
  border-radius: var(--radius);
}
</style>
