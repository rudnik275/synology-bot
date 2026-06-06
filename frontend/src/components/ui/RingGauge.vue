<script setup lang="ts">
// Single-value ring gauge — a neo-brutalist conic sweep framed by the ink ring +
// hard shadow (same visual family as Donut.vue, but for ONE percentage rather
// than a part-to-whole breakdown). The accent tone fills the sweep; the rest of
// the ring is cream; the value sits in a paper hole.
//
// Dumb primitive: value + tone + size in, ring out. No data fetching, no
// thresholds — the caller passes the already-decided tone (e.g. NAS capacity
// severity). `value === null` renders an em-dash (unknown / not-yet-loaded).
import { computed } from 'vue'
import type { Tone } from './tones'

const props = withDefaults(
  defineProps<{
    /** 0–100, or null for "unknown" (renders —). */
    value: number | null
    tone?: Tone
    /** Outer diameter in px. The hole is 66% of this. */
    size?: number
  }>(),
  { tone: 'green', size: 96 },
)

const pct = computed(() => (props.value === null ? 0 : Math.max(0, Math.min(100, Math.round(props.value)))))
const sweep = computed(
  () => `conic-gradient(var(--${props.tone}) ${pct.value}%, var(--cream) ${pct.value}% 100%)`,
)
const holePx = computed(() => Math.round(props.size * 0.66))
</script>

<template>
  <div
    class="ring"
    :style="{ width: size + 'px', height: size + 'px', background: sweep }"
    role="img"
    :aria-label="value === null ? 'Нет данных' : `${pct}%`"
  >
    <div class="hole" :style="{ width: holePx + 'px', height: holePx + 'px' }">
      <b v-if="value !== null">{{ pct }}<small>%</small></b>
      <b v-else class="muted">—</b>
    </div>
  </div>
</template>

<style scoped>
.ring {
  border-radius: 50%;
  border: var(--border);
  box-shadow: var(--shadow-sm);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.hole {
  border-radius: 50%;
  background: var(--paper);
  border: var(--border);
  display: grid;
  place-items: center;
  line-height: 1;
}
.hole b {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}
.hole b small {
  font-size: 12px;
  opacity: 0.5;
  margin-left: 1px;
}
.hole b.muted {
  opacity: 0.4;
}
</style>
