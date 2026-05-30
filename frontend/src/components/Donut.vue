<script setup lang="ts">
// Part-to-whole donut + legend (#102). A neo-brutalism ring (thick ink border +
// hard shadow) whose segments are an ink lightness ramp — NOT the accent
// palette: monochrome keeps it colourblind-safe (distinguished by lightness,
// per the chart guideline) and never collides with the severity colours.
//
// The legend beside it carries the exact values: a donut alone fails WCAG for
// colour-blind users, so the legend is the mandatory data fallback, not decor.
// Largest segment goes first → it starts at 12 o'clock.
import { computed } from 'vue'
import type { DonutSegment } from './donut'

const props = defineProps<{
  segments: DonutSegment[]
  centerValue: string
  centerUnit?: string
  centerCaption?: string
}>()

// Dark → light. Index 0 is the biggest segment (darkest ink).
const RAMP = [
  'var(--ink)',
  'rgba(9, 9, 11, 0.55)',
  'rgba(9, 9, 11, 0.30)',
  'rgba(9, 9, 11, 0.16)',
  'rgba(9, 9, 11, 0.08)',
]

const total = computed(() =>
  Math.max(1, props.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)),
)

const rows = computed(() => {
  let acc = 0
  return props.segments.map((s, i) => {
    const start = (acc / total.value) * 100
    acc += Math.max(0, s.value)
    const end = (acc / total.value) * 100
    return { ...s, color: RAMP[Math.min(i, RAMP.length - 1)]!, start, end }
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
  width: 118px;
  height: 118px;
  border-radius: 50%;
  border: var(--border);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
  display: grid;
  place-items: center;
}
.hole {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--paper);
  border: var(--border);
  display: grid;
  place-items: center;
  text-align: center;
  line-height: 1;
}
.hole b {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}
.hole b small {
  font-size: var(--fs-xs);
  opacity: 0.5;
}
.hole .cap {
  margin-top: 3px;
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
