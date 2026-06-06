<script setup lang="ts">
// Live NAS health view (#70, redesigned in #102). Consumes the shared useHealth
// singleton so it shares the polling loop with the header chip.
//
// Layout follows the ops-dashboard pattern: one storage HERO (busiest volume),
// a CPU+RAM bento, then disks and top-processes. Severity (ok/warn/bad) is
// mapped to the green/amber/red triad — yellow stays reserved for actions, so
// a "warn" never reads as a button (#101 accent split).
import { computed } from 'vue'
import Card from '../components/ui/Card.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import StickerBadge from '../components/ui/StickerBadge.vue'
import ScreenHeader from '../components/ui/ScreenHeader.vue'
import Donut from '../components/ui/Donut.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import type { DonutSegment } from '../components/ui/donut'
import {
  useHealth,
  volumeSeverity,
  diskSeverity,
  pctSeverity,
  type Severity,
} from '../composables/useHealth'
import type { Tone } from '../components/ui/tones'
import { formatBytes, formatPct } from '../format'

const { data, loading, error } = useHealth()

/** Severity → accent tone. The traffic-light triad; warn is amber, not yellow. */
const TONE: Record<Severity, Tone> = { ok: 'green', warn: 'orange', bad: 'red' }
const LABEL: Record<Severity, string> = { ok: 'OK', warn: 'High', bad: 'Critical' }

/** Find the first error reason for a given section name. */
function sectionError(section: string): string | null {
  if (!data.value) return null
  return data.value.errors.find((e) => e.section === section)?.reason ?? null
}

/** POSIX basename — last non-empty path segment. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** DSM sometimes reports a process group with no name (kernel/aggregate slice);
 *  fall back to a neutral placeholder so the row never renders blank. */
function procName(name: string): string {
  return name.trim() || 'unknown'
}

const cpu = computed(() => data.value?.cpu ?? null)
const memory = computed(() => data.value?.memory ?? null)
const disks = computed(() => data.value?.disks ?? null)
const processes = computed(() => data.value?.processes ?? null)

// Volumes sorted busiest-first: the top one becomes the hero, the rest stack
// as compact bars under it.
const sortedVolumes = computed(() =>
  data.value?.volumes ? [...data.value.volumes].sort((a, b) => b.pct - a.pct) : null,
)
const heroVolume = computed(() => sortedVolumes.value?.[0] ?? null)
const restVolumes = computed(() => sortedVolumes.value?.slice(1) ?? [])

// Top-CPU bars are scaled relative to the busiest process. CPU is shown as
// ranked bars, NOT a donut: per-process %CPU is a fraction-of-percent that does
// not sum to a 100% whole, so a part-to-whole donut would be meaningless.
const maxCpu = computed(() =>
  Math.max(1, ...(processes.value?.topCpu ?? []).map((p) => p.pct)),
)

// RAM IS part-to-whole (process bytes are a real fraction of total RAM), so it
// becomes a donut: top processes + "other" used + "free". Center = used/total.
const TOP_RAM_SEGMENTS = 3
const ramDonut = computed(() => {
  const procs = processes.value?.topRam
  if (!procs || procs.length === 0) return null

  const named = procs.slice(0, TOP_RAM_SEGMENTS)
  const segments: DonutSegment[] = named.map((p) => ({
    label: procName(p.name),
    value: p.bytes,
    display: formatBytes(p.bytes),
  }))

  const mem = memory.value
  if (!mem) {
    // No total to compare against — show the processes' relative share only.
    const sum = named.reduce((s, p) => s + p.bytes, 0)
    return { segments, centerValue: formatBytes(sum), centerUnit: '', centerCaption: 'top procs' }
  }

  const other = Math.max(0, mem.usedBytes - named.reduce((s, p) => s + p.bytes, 0))
  const free = Math.max(0, mem.totalBytes - mem.usedBytes)
  if (other > 0)
    segments.push({ label: 'other', value: other, display: formatBytes(other), neutral: true })
  segments.push({ label: 'free', value: free, display: formatBytes(free), muted: true, neutral: true })

  const [usedNum, usedUnit] = formatBytes(mem.usedBytes).split(' ')
  return {
    segments,
    centerValue: usedNum ?? '0',
    centerUnit: usedUnit ?? '',
    centerCaption: `of ${formatBytes(mem.totalBytes)}`,
  }
})
</script>

<template>
  <!-- Loading skeleton: mirrors storage hero + compute bento shape (#208) -->
  <div v-if="loading && !data" data-testid="nas-skeleton" class="nas-tab nas-skeleton" aria-busy="true" aria-label="Загрузка NAS">
    <!-- Hero skeleton — mirrors the storage hero card -->
    <div data-testid="nas-skeleton-hero" class="sk-hero">
      <div class="sk-hero-top">
        <div class="sk-hero-left">
          <Skeleton class="sk-hero-kind" />
          <Skeleton class="sk-hero-name" />
        </div>
        <Skeleton class="sk-hero-badge" />
      </div>
      <Skeleton class="sk-hero-pct" />
      <Skeleton class="sk-hero-bytes" />
      <Skeleton class="sk-hero-bar" />
    </div>
    <!-- Bento skeleton — mirrors the CPU+RAM compute bento -->
    <div data-testid="nas-skeleton-bento" class="sk-bento">
      <div class="sk-metric-cell">
        <Skeleton class="sk-metric-label" />
        <Skeleton class="sk-metric-value" />
        <Skeleton class="sk-metric-sub" />
      </div>
      <div class="sk-metric-cell sk-metric-cell--right">
        <Skeleton class="sk-metric-label" />
        <Skeleton class="sk-metric-value" />
        <Skeleton class="sk-metric-sub" />
      </div>
    </div>
    <!-- Disk rows skeleton -->
    <div class="sk-disks">
      <div v-for="i in 2" :key="i" class="sk-disk-row">
        <Skeleton class="sk-disk-dot" />
        <div class="sk-disk-info">
          <Skeleton class="sk-disk-model" />
          <Skeleton class="sk-disk-meta" />
        </div>
      </div>
    </div>
  </div>

  <!-- Network / auth error (no data at all) -->
  <div v-else-if="error && !data" class="nas-tab">
    <Card tone="red">
      <p class="section-label">Ошибка</p>
      <p class="degraded-reason">{{ error }}</p>
    </Card>
  </div>

  <!-- Data present (possibly partial) -->
  <div v-else-if="data" class="nas-tab">
    <ScreenHeader title="NAS" subtitle="Состояние" />

    <!-- ── Storage hero (busiest volume) ── -->
    <!-- "ok" reads as a plain paper card — only the badge carries the colour.
         warn/bad keep a loud coloured fill so a problem volume grabs attention. -->
    <section
      v-if="heroVolume"
      class="hero"
      :class="volumeSeverity(heroVolume) !== 'ok' ? `fill-${TONE[volumeSeverity(heroVolume)]}` : ''"
    >
      <div class="hero-top">
        <div>
          <p class="hero-kind">Хранилище · самый полный</p>
          <p class="hero-name">{{ basename(heroVolume.path) }}</p>
        </div>
        <StickerBadge :tone="TONE[volumeSeverity(heroVolume)]">
          {{ LABEL[volumeSeverity(heroVolume)] }} · {{ heroVolume.pct }}%
        </StickerBadge>
      </div>
      <div class="hero-pct">{{ heroVolume.pct }}<span class="hero-unit">%</span></div>
      <p class="hero-bytes">
        {{ formatBytes(heroVolume.usedBytes) }} / {{ formatBytes(heroVolume.totalBytes) }}
        · {{ formatBytes(heroVolume.totalBytes - heroVolume.usedBytes) }} свободно
      </p>
      <div class="hero-bar"><ProgressBar :value="heroVolume.pct" tone="default" hide-label /></div>
    </section>

    <!-- secondary volumes as compact bars -->
    <div v-for="vol in restVolumes" :key="vol.path" class="vrow">
      <div class="vrow-head">
        <span class="vrow-name">{{ basename(vol.path) }}</span>
        <span class="vrow-pct">{{ vol.pct }}%</span>
      </div>
      <ProgressBar :value="vol.pct" :tone="TONE[volumeSeverity(vol)]" hide-label />
    </div>

    <!-- degraded storage -->
    <Card v-if="!sortedVolumes" tone="orange">
      <p class="section-label">Хранилище</p>
      <p class="degraded-reason">{{ sectionError('storage') ?? sectionError('volumes') ?? 'Недоступно' }}</p>
    </Card>

    <!-- ── Compute bento: CPU + RAM (one flat panel, hairline split) ── -->
    <p class="section-head">Нагрузка</p>
    <Card variant="flat" class="group">
      <div class="bento">
        <div class="metric-cell">
          <p class="section-label">CPU</p>
          <template v-if="cpu">
            <div class="metric">{{ cpu.userLoad }}<span class="metric-unit">%</span></div>
            <p class="metric-sub">usr {{ cpu.userLoad }} · sys {{ cpu.systemLoad }}</p>
          </template>
          <p v-else class="degraded-reason">{{ sectionError('cpu') ?? 'Недоступно' }}</p>
        </div>
        <div class="metric-cell">
          <p class="section-label">RAM</p>
          <template v-if="memory">
            <div class="metric">{{ memory.pct }}<span class="metric-unit">%</span></div>
            <p class="metric-sub">{{ formatBytes(memory.usedBytes) }} / {{ formatBytes(memory.totalBytes) }}</p>
            <div class="metric-bar"><ProgressBar :value="memory.pct" :tone="TONE[pctSeverity(memory.pct)]" hide-label /></div>
          </template>
          <p v-else class="degraded-reason">{{ sectionError('memory') ?? 'Недоступно' }}</p>
        </div>
      </div>
    </Card>

    <!-- ── Диски ── -->
    <p class="section-head">Диски <span v-if="disks" class="count">· {{ disks.length }}</span></p>
    <template v-if="disks">
      <!-- one flat panel; rows divided by hairlines (not 3 floating boxes) -->
      <Card variant="flat" class="group">
        <!-- key on model+index: same-model multi-bay NAS collide on model alone -->
        <div v-for="(disk, i) in disks" :key="`${disk.model}-${i}`" class="disk" :class="`edge-${TONE[diskSeverity(disk)]}`">
          <span class="disk-dot" :class="`dot-${TONE[diskSeverity(disk)]}`" aria-hidden="true"></span>
          <div class="disk-main">
            <p class="disk-model">{{ disk.model }}</p>
            <p class="disk-meta">bay {{ i + 1 }} · {{ disk.tempC }}°C · {{ disk.tempStatus }}</p>
          </div>
          <StickerBadge :tone="TONE[diskSeverity(disk)]" :rotate="-2">{{ disk.smart }}</StickerBadge>
        </div>
      </Card>
    </template>
    <Card v-else tone="orange">
      <p class="section-label">Диски</p>
      <p class="degraded-reason">{{ sectionError('disks') ?? 'Недоступно' }}</p>
    </Card>

    <!-- ── Top processes ── -->
    <template v-if="processes">
      <p class="section-head">Топ CPU</p>
      <Card variant="flat" class="group">
        <div v-for="(proc, i) in processes.topCpu" :key="`cpu-${proc.name}-${i}`" class="proc">
          <span class="proc-rank">{{ i + 1 }}</span>
          <span class="proc-name">{{ procName(proc.name) }}</span>
          <div class="proc-bar"><ProgressBar :value="(proc.pct / maxCpu) * 100" tone="default" hide-label /></div>
          <span class="proc-val">{{ formatPct(proc.pct) }}</span>
        </div>
      </Card>

      <p class="section-head">Топ RAM</p>
      <!-- flat (border, no shadow) to match the other lower sections — the shadow
           is reserved for the storage hero now (round-2: consistency, option b). -->
      <Card v-if="ramDonut" variant="flat">
        <Donut
          :segments="ramDonut.segments"
          :center-value="ramDonut.centerValue"
          :center-unit="ramDonut.centerUnit"
          :center-caption="ramDonut.centerCaption"
        />
      </Card>
    </template>
    <Card v-else tone="orange">
      <p class="section-label">Процессы</p>
      <p class="degraded-reason">{{ sectionError('processes') ?? 'Недоступно' }}</p>
    </Card>
  </div>

  <!-- No data, no loading, no error — shouldn't happen in practice -->
  <div v-else class="nas-tab">
    <Card><p class="section-label">Нет данных</p></Card>
  </div>
</template>

<style scoped>
.nas-tab {
  display: flex;
  flex-direction: column;
  /* #270 task 11: tight 4px base gap so each section label hugs its own card;
     the larger gap that separates one section block from the next comes from the
     section-head's top margin (below). */
  gap: var(--space-1);
  padding: var(--space-4);
}

/* «СОСТОЯНИЕ» subtitle hugs the storage hero — drop the shared header's bottom
   margin so the only gap is the 4px base (#270 task 11). */
.nas-tab :deep(.screen-header) {
  margin-bottom: 0;
}

/* ── NAS loading skeleton (#208) ── */
.nas-skeleton {
  gap: var(--space-3);
}

/* Hero skeleton — mirrors the .hero card shape */
.sk-hero {
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-1);
}

.sk-hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}

.sk-hero-left {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sk-hero-kind {
  height: 11px;
  width: 90px;
}

.sk-hero-name {
  height: 18px;
  width: 64px;
}

.sk-hero-badge {
  height: 22px;
  width: 80px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.sk-hero-pct {
  height: 36px;
  width: 72px;
}

.sk-hero-bytes {
  height: 12px;
  width: 60%;
}

.sk-hero-bar {
  height: 18px;
  width: 100%;
  border-radius: 6px;
}

/* Bento skeleton — mirrors CPU+RAM flat panel grid */
.sk-bento {
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}

.sk-metric-cell {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sk-metric-cell--right {
  border-left: var(--hairline);
}

.sk-metric-label {
  height: 10px;
  width: 30px;
}

.sk-metric-value {
  height: 28px;
  width: 52px;
}

.sk-metric-sub {
  height: 10px;
  width: 75%;
}

/* Disk row skeletons */
.sk-disks {
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.sk-disk-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
}

.sk-disk-row + .sk-disk-row {
  border-top: var(--hairline);
}

.sk-disk-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-disk-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sk-disk-model {
  height: 14px;
  width: 55%;
}

.sk-disk-meta {
  height: 11px;
  width: 40%;
}

/* ── Section heads + labels ── */
.section-head {
  /* #270 task 11: 4px above its own card (via the base gap; mb:0), ~16px below
     the previous section's card (this 12px top margin + 4px base gap). */
  margin: var(--space-3) 0 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
}
.section-head .count {
  opacity: 0.7;
}
.section-label {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.55;
}

/* ── Storage hero ── */
.hero {
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
  /* #270 task 11: separation from the next section comes from that section-head's
     top margin, not here — keeps the «НАГРУЗКА» label ~16px below this card. */
  margin-bottom: 0;
}
.fill-orange { background: var(--orange); }
.fill-red { background: var(--red); }
.hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.hero-kind {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.65;
}
.hero-name {
  margin: 2px 0 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.hero-pct {
  font-size: var(--fs-2xl, 36px);
  font-weight: var(--fw-bold);
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
}
.hero-unit {
  font-size: var(--fs-lg);
}
.hero-bytes {
  margin: 4px 0 var(--space-3);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
/* On the filled hero the bar reads as ink-on-cream for max contrast. */
.hero-bar :deep(.track) {
  border-width: var(--border-thick);
}

/* ── Secondary volume rows ── */
.vrow {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}
.vrow-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--fs-sm);
}
.vrow-name {
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.vrow-pct {
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}

/* ── Grouped flat panel (#101 elevation tiers) ──
 * One flat Card whose children read as quiet hairline-divided rows, so a
 * section is a single calm surface instead of a stack of identical boxes. */
.group {
  padding: 0;
  overflow: hidden; /* clip hairline rows to the card radius */
}

/* ── Compute bento (cells inside the flat panel) ── */
.bento {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.metric-cell {
  padding: var(--space-3);
}
.metric-cell + .metric-cell {
  border-left: var(--hairline);
}
.metric {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.metric-unit {
  font-size: var(--fs-md);
  opacity: 0.5;
}
.metric-sub {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.metric-bar {
  margin-top: var(--space-2);
}

/* ── Disk rows (hairline-divided inside the flat panel) ── */
.disk {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
}
.disk + .disk {
  border-top: var(--hairline);
}
/* bad/warn disks get a coloured inset edge so the row reads at a glance */
.disk.edge-orange {
  box-shadow: inset var(--space-1) 0 0 var(--orange);
}
.disk.edge-red {
  box-shadow: inset var(--space-1) 0 0 var(--red);
}
.disk-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: var(--border-thin) solid var(--ink);
  flex-shrink: 0;
}
.dot-green { background: var(--green); }
.dot-orange { background: var(--orange); }
.dot-red { background: var(--red); }
.disk-main {
  flex: 1;
  min-width: 0;
}
.disk-model {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.2;
}
.disk-meta {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

/* ── Process rank rows (hairline-divided inside the flat panel) ── */
.proc {
  display: grid;
  grid-template-columns: 16px 76px 1fr 68px;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
}
.proc + .proc {
  border-top: var(--hairline);
}
.proc-rank {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  opacity: 0.4;
  font-variant-numeric: tabular-nums;
}
.proc-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proc-val {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.degraded-reason {
  margin: 0;
  font-size: var(--fs-sm);
  opacity: 0.8;
}
</style>
