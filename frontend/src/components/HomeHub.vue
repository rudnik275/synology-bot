<script setup lang="ts">
// Home hub — "Бенто" layout. An asymmetric grid that breaks the old uniform
// 3-stack so tile size encodes importance (supersedes the equal-height Variant B
// rows; ADR 0015, #223):
//   - Загрузки (yellow, wide hero): big active-count + aggregate speed + a live
//     list of the top active tasks, each with its own progress bar.
//   - NAS (green, square): a ring gauge of the busiest volume % + used/total.
//   - Шоу (violet, tall): big new-episode count + the new episodes as a list.
//
// First load: content-shaped skeleton (no layout shift).
// Poll update: tiles update in place via computed (no full-page reload, ADR-0012).
// Nav preserved: each tile emits `navigate` with the SectionKey (S1 #222), and
// keeps the `hub-row-<section>` test ids the shell + tests depend on.
import { computed } from 'vue'
import Card from './ui/Card.vue'
import ProgressBar from './ui/ProgressBar.vue'
import RingGauge from './ui/RingGauge.vue'
import Skeleton from './ui/Skeleton.vue'
import ScreenHeader from './ui/ScreenHeader.vue'
// Imported (not /logo.png from public/) so Vite emits it into dist/assets/, which
// the backend actually serves; root-level dist files fall through to the SPA
// index.html catch-all and 404 as an image (see src/server/server.ts).
import logoUrl from '../assets/logo.png'
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

// Show skeleton when there is no data at all yet from ANY source (first-load
// skeleton, no layout shift; in-place poll updates thereafter — ADR-0012).
const firstLoad = computed(
  () => tasks.value.length === 0 && !healthData.value && subscriptions.value.length === 0,
)

// ── Derived summaries (pure, tested in hubSummaries.test.ts) ─────────────────
const downloads = computed(() => deriveDownloadsSummary(tasks.value))
const nas = computed(() => deriveNasSummary(healthData.value?.volumes ?? null))
const shows = computed(() => deriveShowsSummary(subscriptions.value))

// Top active tasks for the hero list (downloading / waiting / finishing),
// fastest first. The hero shows up to 3; any overflow is summarised as "+N".
const ACTIVE = new Set(['downloading', 'waiting', 'finishing'])
const HERO_TASKS = 3
const activeTasks = computed(() =>
  tasks.value
    .filter((t) => ACTIVE.has(t.status))
    .sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec || b.pct - a.pct)
    .slice(0, HERO_TASKS),
)
const overflowCount = computed(() => Math.max(0, downloads.value.activeCount - activeTasks.value.length))
</script>

<template>
  <div class="hub">
    <header class="brand">
      <img class="brand-logo" :src="logoUrl" alt="NAS Bot" width="56" height="56" decoding="async" />
      <ScreenHeader title="Главная" />
    </header>

    <!-- ── First-load skeleton (bento-shaped) ── -->
    <div v-if="firstLoad" class="bento" data-testid="hub-skeleton" aria-busy="true" aria-label="Загрузка">
      <div class="sk-tile sk-tile--hero">
        <Skeleton class="sk-num" />
        <Skeleton class="sk-bar" />
        <Skeleton class="sk-bar" />
      </div>
      <div class="sk-tile">
        <Skeleton class="sk-ring" />
      </div>
      <div class="sk-tile">
        <Skeleton class="sk-num sk-num--sm" />
        <Skeleton class="sk-line" />
        <Skeleton class="sk-line" />
      </div>
    </div>

    <!-- ── Бенто grid ── -->
    <div v-else class="bento">
      <!-- ── Загрузки — wide hero ── -->
      <Card
        tone="yellow"
        interactive
        class="tile tile--downloads"
        role="button"
        tabindex="0"
        data-testid="hub-row-downloads"
        aria-label="Загрузки"
        @click="$emit('navigate', 'downloads')"
        @keydown.enter="$emit('navigate', 'downloads')"
      >
        <div class="dl-head">
          <div class="dl-count">
            <span class="big-num">{{ downloads.activeCount }}</span>
            <span class="dl-label">загрузки<br />активны</span>
          </div>
          <span v-if="downloads.aggregateSpeed !== '—'" class="speed-chip">↓ {{ downloads.aggregateSpeed }}</span>
        </div>

        <ul v-if="activeTasks.length" class="dl-list">
          <li v-for="t in activeTasks" :key="t.id" class="dl-row">
            <div class="dl-row-top">
              <span class="dl-title">{{ t.title }}</span>
              <span class="dl-pct">{{ t.pct }}%</span>
            </div>
            <ProgressBar :value="t.pct" tone="yellow" hide-label />
          </li>
          <li v-if="overflowCount > 0" class="dl-more">+{{ overflowCount }} ещё</li>
        </ul>
        <p v-else class="empty">Нет активных загрузок</p>
      </Card>

      <!-- ── NAS — square ring tile ── -->
      <Card
        tone="green"
        interactive
        class="tile tile--nas"
        role="button"
        tabindex="0"
        data-testid="hub-row-nas"
        aria-label="NAS"
        @click="$emit('navigate', 'nas')"
        @keydown.enter="$emit('navigate', 'nas')"
      >
        <span class="tile-label">NAS</span>
        <RingGauge :value="nas.pct" :tone="nas.capTone" :size="104" />
        <div class="nas-meta">
          <b>{{ nas.volumeName ?? '—' }}</b>
          <span v-if="nas.usedLabel">{{ nas.usedLabel }} / {{ nas.totalLabel }}</span>
        </div>
      </Card>

      <!-- ── Шоу — tall count tile ── -->
      <Card
        tone="violet"
        interactive
        class="tile tile--shows"
        role="button"
        tabindex="0"
        data-testid="hub-row-shows"
        aria-label="Шоу"
        @click="$emit('navigate', 'shows')"
        @keydown.enter="$emit('navigate', 'shows')"
      >
        <span class="tile-label">Шоу</span>
        <div class="shows-count">
          <span class="big-num">{{ shows.newCount }}</span>
          <span class="shows-sub">новых<br />серий</span>
        </div>
        <ul v-if="shows.newEpisodes.length" class="shows-eps">
          <li v-for="ep in shows.newEpisodes" :key="ep.id">{{ ep.label }}</li>
        </ul>
        <p v-else class="empty">по подпискам</p>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.hub {
  padding: var(--space-4);
  /* The offset box-shadow on tiles bleeds past a tight right edge; 16px padding
   * clears the 5px shadow, and overflow-x:clip is a backstop that doesn't create
   * a new BFC (unlike overflow:hidden, which would break position:sticky). */
  overflow-x: clip;
}

/* ── Brand row: logo + screen title ── */
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.brand-logo {
  /* Framed as a neo-brutalist app-icon tile (matches the card language). The logo
   * art carries its own cream dot-grid background; the black border is the clean
   * boundary between page-cream and image-cream, so there's no mismatched patch.
   * object-fit:cover + radius clips the outer padding to the rounded frame. */
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: block;
  object-fit: cover;
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
/* ScreenHeader owns its own bottom margin; move it to the brand row so the logo
   and title align as one unit. */
.brand :deep(.screen-header) {
  margin-bottom: 0;
}

.bento {
  display: grid;
  /* Equal halves: NAS + Shows in the bottom row are the same width (the
   * full-width Downloads hero carries the bento asymmetry). Grid stretch also
   * keeps the two tiles the same height. */
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

/* ── Tiles ── */
.tile {
  /* Account for the 6px top accent strip (Card ::before). */
  padding-top: calc(var(--space-4) + 6px);
  /* Deeper press → these are the focus of the screen. */
  --press: 5px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tile--downloads {
  grid-column: 1 / -1;
}

/* Oversized neo-brutalist hero figure. */
.big-num {
  font-size: 52px;
  font-weight: var(--fw-bold);
  line-height: 0.85;
  font-variant-numeric: tabular-nums;
}
.tile-label {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Downloads hero ── */
.dl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.dl-count {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.dl-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.05;
}
.speed-chip {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  background: var(--yellow);
  border: var(--border-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
}
.dl-list {
  list-style: none;
  margin: 0;
  padding: var(--space-3) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-top: var(--hairline);
}
.dl-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dl-row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.dl-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dl-pct {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}
.dl-more {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  opacity: 0.5;
}

/* ── NAS tile ── */
.tile--nas {
  align-items: center;
  text-align: center;
}
.tile--nas .tile-label {
  align-self: flex-start;
}
.nas-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-xs);
}
.nas-meta b {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
}
.nas-meta span {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

/* ── Shows tile ── */
.shows-count {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.shows-sub {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.05;
}
.shows-eps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shows-eps li {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: var(--space-3);
  position: relative;
}
.shows-eps li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--violet);
  border: 2px solid var(--ink);
}

.empty {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  opacity: 0.4;
}

/* ── Skeleton (bento-shaped) ── */
.sk-tile {
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.sk-tile--hero {
  grid-column: 1 / -1;
}
.sk-num { height: 44px; width: 120px; border-radius: 6px; }
.sk-num--sm { height: 40px; width: 80px; }
.sk-bar { height: 14px; width: 100%; border-radius: 4px; }
.sk-line { height: 12px; width: 70%; border-radius: 4px; }
.sk-ring {
  height: 104px;
  width: 104px;
  border-radius: 50%;
  align-self: center;
}
</style>
