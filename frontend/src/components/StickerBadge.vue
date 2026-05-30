<script setup lang="ts">
// A rotated sticker label — the neo-brutalism signature. Used for status tags
// (DOWNLOADING / DONE / STUCK), counts, and category chips. Slightly rotated by
// default so it reads as a stuck-on sticker, not a flat pill.
import { computed } from 'vue'
import type { Tone } from './tones'
import { usePrefersReducedMotion } from '../composables/usePrefersReducedMotion'

const props = withDefaults(
  defineProps<{
    tone?: Tone
    /** Rotation in degrees. A small tilt sells the "sticker" feel. */
    rotate?: number
  }>(),
  { tone: 'yellow', rotate: -3 },
)

// The tilt is an inline transform, so the global reduced-motion CSS rule can't
// neutralise it (#101 E). Sit the sticker flat when the user asks for reduced
// motion, so the signature is "re-asserted sparingly" and stays opt-out.
const { prefersReducedMotion } = usePrefersReducedMotion()
const tilt = computed(() => (prefersReducedMotion.value ? 'none' : `rotate(${props.rotate}deg)`))
</script>

<template>
  <span class="sticker" :class="`tone-${tone}`" :style="{ transform: tilt }">
    <slot />
  </span>
</template>

<style scoped>
.sticker {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  white-space: nowrap;
}
.tone-default {
  background: var(--paper);
}
.tone-red {
  background: var(--red);
}
.tone-orange {
  background: var(--orange);
}
.tone-yellow {
  background: var(--yellow);
}
.tone-green {
  background: var(--green);
}
.tone-violet {
  background: var(--violet);
  color: var(--cream);
}
</style>
