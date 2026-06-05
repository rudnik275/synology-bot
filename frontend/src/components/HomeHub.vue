<script setup lang="ts">
// Home hub — S2 Variant B live row summaries (#223, ADR 0015).
//
// Three full-width raised cards, each a mini-dashboard:
//   - Загрузки (yellow top strip): active-count + aggregate-speed + top task progress bar.
//   - NAS (green top strip): busiest-volume % + capacity bar + health dot.
//   - Шоу (violet top strip): new-episode count + episode chips.
//
// First load: content-shaped skeleton (no layout shift).
// Poll update: rows update in place via computed (no full-page reload, ADR-0012).
// Nav preserved: each card still emits `navigate` with the SectionKey (S1 #222).
import { computed } from 'vue'
import Card from './ui/Card.vue'
import ProgressBar from './ui/ProgressBar.vue'
import Chip from './ui/Chip.vue'
import Skeleton from './ui/Skeleton.vue'
import ScreenHeader from './ui/ScreenHeader.vue'
import type { SectionKey } from '../sections'
import { useTasks } from '../composables/useTasks'
import { useHealth } from '../composables/useHealth'
import { useSubscriptions } from '../composables/useSubscriptions'
import { deriveDownloadsSummary, deriveNasSummary, deriveShowsSummary } from '../composables/hubSummaries'

defineEmits<{ navigate: [SectionKey] }>()

// ── Data composables (each owns its own polling) ─────────────────────────────
const { tasks } = useTasks()
const { data: healthData } = useHealth()
const { subscriptions } = useSubscriptions()

// Show skeleton when there is no data at all yet from ANY source.
// Mirrors the pattern used in NasTab/DownloadsTab: first-load skeleton
// (no layout shift), in-place poll updates thereafter (ADR-0012).
// Note: loading flags are not required — if all refs are empty, we skeleton.
const firstLoad = computed(
  () => tasks.value.length === 0 && !healthData.value && subscriptions.value.length === 0,
)

// ── Derived summaries (pure, tested in hubSummaries.test.ts) ─────────────────
const downloads = computed(() => deriveDownloadsSummary(tasks.value))
const nas = computed(() => deriveNasSummary(healthData.value?.volumes ?? null))
const shows = computed(() => deriveShowsSummary(subscriptions.value))
</script>

<template>
  <div class="hub">
    <ScreenHeader title="Главная" />

    <!-- ── First-load skeleton ── -->
    <div v-if="firstLoad" class="hub-rows" data-testid="hub-skeleton" aria-busy="true" aria-label="Загрузка">
      <div v-for="i in 3" :key="i" class="sk-card">
        <div class="sk-header">
          <Skeleton class="sk-title" />
          <Skeleton class="sk-metric" />
        </div>
        <Skeleton class="sk-subtitle" />
        <Skeleton class="sk-bar" />
        <div class="sk-footer">
          <Skeleton class="sk-footer-text" />
          <Skeleton class="sk-chevron" />
        </div>
      </div>
    </div>

    <!-- ── Live Variant B rows ── -->
    <ul v-else class="hub-rows">
      <!-- ── Загрузки — yellow primary ── -->
      <li>
        <Card
          tone="yellow"
          interactive
          class="hub-card"
          role="button"
          tabindex="0"
          :data-testid="`hub-row-downloads`"
          aria-label="Загрузки"
          @click="$emit('navigate', 'downloads')"
          @keydown.enter="$emit('navigate', 'downloads')"
        >
          <!-- Header: label + active count figure -->
          <div class="card-header">
            <span class="card-label">Загрузки</span>
            <span class="card-figure">
              <b>{{ downloads.activeCount }}</b> активны
            </span>
          </div>

          <!-- Top task: title + progress bar -->
          <template v-if="downloads.topTask">
            <p class="card-subtitle">{{ downloads.topTask.title }}</p>
            <div class="card-bar">
              <ProgressBar :value="downloads.topTask.pct" tone="yellow" hide-label />
            </div>
          </template>
          <template v-else>
            <p class="card-subtitle card-subtitle--muted">Нет активных загрузок</p>
            <div class="card-bar">
              <ProgressBar :value="0" tone="yellow" hide-label />
            </div>
          </template>

          <!-- Footer: speed + chevron -->
          <div class="card-footer">
            <span class="card-footer-meta">↓ {{ downloads.aggregateSpeed }}</span>
            <span class="card-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </Card>
      </li>

      <!-- ── NAS — green paper ── -->
      <li>
        <Card
          tone="green"
          interactive
          class="hub-card"
          role="button"
          tabindex="0"
          :data-testid="`hub-row-nas`"
          aria-label="NAS"
          @click="$emit('navigate', 'nas')"
          @keydown.enter="$emit('navigate', 'nas')"
        >
          <!-- Header: label + pct metric with health dot -->
          <div class="card-header">
            <span class="card-label">NAS</span>
            <span v-if="nas.pct !== null" class="card-figure card-figure--nas">
              <span
                class="health-dot"
                :class="`health-dot--${nas.capTone}`"
                aria-hidden="true"
              />
              {{ nas.pct }}%
            </span>
            <span v-else class="card-figure card-figure--muted">—</span>
          </div>

          <!-- Volume name + capacity bar -->
          <template v-if="nas.pct !== null">
            <p class="card-subtitle">{{ nas.volumeName }}</p>
            <div class="card-bar">
              <ProgressBar :value="nas.pct" :tone="nas.capTone" hide-label />
            </div>
          </template>
          <template v-else>
            <p class="card-subtitle card-subtitle--muted">Нет данных</p>
            <div class="card-bar">
              <ProgressBar :value="0" tone="green" hide-label />
            </div>
          </template>

          <!-- Footer: used / total + chevron -->
          <div class="card-footer">
            <span v-if="nas.volumeName && nas.usedLabel" class="card-footer-meta">
              {{ nas.volumeName }} · {{ nas.usedLabel }} / {{ nas.totalLabel }}
            </span>
            <span v-else class="card-footer-meta">—</span>
            <span class="card-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </Card>
      </li>

      <!-- ── Шоу — violet paper ── -->
      <li>
        <Card
          tone="violet"
          interactive
          class="hub-card"
          role="button"
          tabindex="0"
          :data-testid="`hub-row-shows`"
          aria-label="Шоу"
          @click="$emit('navigate', 'shows')"
          @keydown.enter="$emit('navigate', 'shows')"
        >
          <!-- Header: label + new-episode count badge -->
          <div class="card-header">
            <span class="card-label">Шоу</span>
            <span class="card-figure">{{ shows.newCount }} новых</span>
          </div>

          <!-- Episode chips for new episodes -->
          <div v-if="shows.newEpisodes.length > 0" class="card-chips">
            <Chip v-for="ep in shows.newEpisodes" :key="ep.id" variant="flat">
              {{ ep.label }}
            </Chip>
          </div>
          <p v-else class="card-subtitle card-subtitle--muted">Нет новых серий</p>

          <!-- Footer: static tagline + chevron -->
          <div class="card-footer">
            <span class="card-footer-meta">новые серии по подпискам</span>
            <span class="card-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </Card>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hub {
  padding: var(--space-4);
  /* #250 fix 2: the 5px offset box-shadow on hub-cards bleeds past the right
   * edge if the viewport is tight. 16px padding clears 5px shadow, but adding
   * overflow-x:clip as a backstop catches any edge case without creating a new
   * BFC (clip does not affect position:sticky unlike overflow:hidden). */
  overflow-x: clip;
}

.hub-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* ── Dashboard card layout ── */
.hub-card {
  /* Account for top accent strip (::before adds 6px; add margin-top so content
   * doesn't sit directly under the strip). */
  padding-top: calc(var(--space-4) + 6px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* Deeper shadow on hub cards → they are the focus of the screen. */
  --press: 5px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-label {
  /* #250 fix 3: bump from xs (12px) to md (16px) and full opacity so the block
   * name reads as a primary heading, not a secondary label. Keep bold +
   * uppercase so the neo-brutalist identity is preserved. */
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 1;
}

.card-figure {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
}

.card-figure--muted {
  opacity: 0.4;
}

.card-figure--nas {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

/* ── Health dot (NAS row) ── */
/* 12px circle, thick border, bg = semantic health colour */
.health-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: var(--border-thin) solid var(--ink);
  flex-shrink: 0;
}
.health-dot--green  { background: var(--ok); }
.health-dot--orange { background: var(--warn); }
.health-dot--red    { background: var(--bad); }

.card-subtitle {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.card-subtitle--muted {
  opacity: 0.4;
}

.card-bar {
  /* ProgressBar is full-width inside the card */
}

.card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.card-footer-meta {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-chevron svg {
  display: block;
  width: 18px;
  height: 18px;
  opacity: 0.4;
  flex-shrink: 0;
}

/* ── Skeleton cards ── */
.sk-card {
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.sk-title  { height: 12px; width: 60px;  border-radius: 4px; }
.sk-metric { height: 20px; width: 80px;  border-radius: 4px; }
.sk-subtitle { height: 14px; width: 70%;  border-radius: 4px; }
.sk-bar    { height: 14px; width: 100%; border-radius: 4px; }

.sk-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.sk-footer-text { height: 12px; width: 50%; border-radius: 4px; }
.sk-chevron     { height: 18px; width: 18px; border-radius: 4px; }
</style>
