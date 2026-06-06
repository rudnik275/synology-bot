<script setup lang="ts">
// Hard-edged progress bar: black track, accent fill, no rounding. Width animates
// (the one "organic" easing we allow on data) so downloads visibly grow.
import { computed } from 'vue'
import type { Tone } from './tones'

const props = withDefaults(
  defineProps<{
    /** 0–100. Clamped. */
    value: number
    tone?: Tone
    /** Hide the trailing percentage label. */
    hideLabel?: boolean
  }>(),
  { tone: 'green', hideLabel: false },
)

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.value))))
</script>

<template>
  <div class="progress" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
    <div class="track nb-framed">
      <div class="fill" :class="`tone-${tone}`" :style="{ width: pct + '%' }" />
    </div>
    <span v-if="!hideLabel" class="label">{{ pct }}%</span>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* Track geometry only — the rounded clip + black outline come from .nb-framed
   (tokens.css), which paints the outline as an inset overlay over a FULL-BLEED
   fill so the fill reaches the corners with no cream sliver (esp. iOS WebView). */
.track {
  flex: 1;
  height: 14px;
  background: var(--cream);
}
.fill {
  height: 100%;
  transition: width var(--dur-enter) var(--ease-out);
}
.fill.tone-default {
  background: var(--ink);
}
.fill.tone-red {
  background: var(--red);
}
.fill.tone-orange {
  background: var(--orange);
}
.fill.tone-yellow {
  background: var(--yellow);
}
.fill.tone-green {
  background: var(--green);
}
.fill.tone-violet {
  background: var(--violet);
}
.label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  min-width: 3ch;
  text-align: right;
}
</style>
