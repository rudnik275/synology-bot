<script setup lang="ts">
// A rotated sticker label — the neo-brutalism signature. Used for status tags
// (DOWNLOADING / DONE / STUCK), counts, and category chips. Slightly rotated by
// default so it reads as a stuck-on sticker, not a flat pill.
import { computed, ref, watch } from 'vue'
import type { Tone } from './tones'
import { usePrefersReducedMotion } from '../../composables/usePrefersReducedMotion'

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

// Pop animation: toggle a transient CSS class when tone changes, driving
// @keyframes badge-pop (scale 1 → 1.12 → 1). Gate behind reduced-motion:
// when reduced, skip the class entirely so the badge sits flat.
const isPopping = ref(false)
let popTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.tone,
  () => {
    if (prefersReducedMotion.value) return
    // Reset first (handles rapid tone changes)
    if (popTimer !== null) {
      clearTimeout(popTimer)
      isPopping.value = false
    }
    // Use rAF to let Vue apply the reset before setting the class again
    requestAnimationFrame(() => {
      isPopping.value = true
      popTimer = setTimeout(() => {
        isPopping.value = false
        popTimer = null
      }, 200) // slightly longer than --dur-badge-pop (180ms) to cover the full keyframe
    })
  },
)
</script>

<template>
  <span class="sticker" :class="[`tone-${tone}`, { 'is-popping': isPopping }]" :style="{ transform: tilt }">
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

/* Pop keyframe: scale up to ~1.12 then snap back. transform only — no layout. */
@keyframes badge-pop {
  0%   { transform: scale(1); }
  45%  { transform: scale(1.12); }
  100% { transform: scale(1); }
}

.is-popping {
  animation: badge-pop var(--dur-badge-pop) var(--ease-pop) both;
}
</style>
