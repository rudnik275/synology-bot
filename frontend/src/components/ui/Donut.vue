<script setup lang="ts">
// Part-to-whole donut + legend (#102). A neo-brutalism ring (thick ink border +
// hard shadow). Named entries get a categorical colour palette so the chart
// reads at a glance; aggregate buckets ("other"/"free") stay neutral grey so the
// real entries are the only coloured slices. The hues are chart-only and chosen
// to NOT collide with the severity triad (green/amber/red) or the action yellow.
//
// Colour is never the only signal: the legend beside the ring carries every
// label + exact value, so the chart stays usable for colour-blind users (WCAG)
// — the legend is the mandatory data fallback, not decor.
// Largest segment goes first → it starts at 12 o'clock.
import { computed } from 'vue'
import type { DonutSegment } from './donut'

const props = defineProps<{
  segments: DonutSegment[]
  centerValue: string
  centerUnit?: string
  centerCaption?: string
}>()

// Categorical hues for named entries (violet + a cyan + a pink). Distinct from
// the severity colours so a process slice never reads as "warn"/"critical".
const HUES = ['var(--violet)', '#2bc4d4', '#ff6db3', '#ffb02e']
// Neutral greys for aggregate buckets: "other" (mid) then "free" (faint).
// Values mirror --donut-neutral and --donut-faint in tokens.css — read at
// runtime via getComputedStyle so the token is the single source of truth.
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
const NEUTRAL = computed(() => [cssVar('--donut-neutral'), cssVar('--donut-faint')])

const total = computed(() =>
  Math.max(1, props.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)),
)

const rows = computed(() => {
  let acc = 0
  let hue = 0
  let grey = 0
  return props.segments.map((s) => {
    const start = (acc / total.value) * 100
    acc += Math.max(0, s.value)
    const end = (acc / total.value) * 100
    const neutral = NEUTRAL.value
    const color = s.neutral
      ? neutral[Math.min(grey++, neutral.length - 1)]!
      : HUES[Math.min(hue++, HUES.length - 1)]!
    return { ...s, color, start, end }
  })
})

const gradient = computed(
  () => `conic-gradient(${rows.value.map((r) => `${r.color} ${r.start}% ${r.end}%`).join(', ')})`,
)
</script>

<template>
  <div class="donut-wrap">
    <div class="donut" :style="{ background: gradient }" aria-hidden="true">
      <div class="hole">
        <b>{{ centerValue }}<small v-if="centerUnit">{{ centerUnit }}</small></b>
        <span v-if="centerCaption" class="cap">{{ centerCaption }}</span>
      </div>
    </div>
    <ul class="legend">
      <li v-for="row in rows" :key="row.label" class="leg" :class="{ muted: row.muted }">
        <span class="sw" :style="{ background: row.color }"></span>
        <span class="ln">{{ row.label }}</span>
        <span class="lv">{{ row.display }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.donut {
  width: 128px;
  height: 128px;
  border-radius: 50%;
  border: var(--border);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
  display: grid;
  place-items: center;
}
.hole {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  background: var(--paper);
  border: var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  text-align: center;
  line-height: 1;
  padding: 0 var(--space-1);
}
.hole b {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hole b small {
  font-size: 11px;
  margin-left: 1px;
  opacity: 0.5;
}
.hole .cap {
  font-size: 10px;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.leg {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--fs-sm);
}
.leg .sw {
  width: 12px;
  height: 12px;
  border: var(--border-thin) solid var(--ink);
  border-radius: 3px;
}
.leg .ln {
  font-weight: var(--fw-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.leg .lv {
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}
.leg.muted .ln,
.leg.muted .lv {
  opacity: 0.5;
}
</style>
