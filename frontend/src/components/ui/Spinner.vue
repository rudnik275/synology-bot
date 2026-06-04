<script setup lang="ts">
// Spinner — a single circular activity indicator used across the app.
//
// One keyframe (`spinner-spin`) lives here; the two former duplicates
// (addflow-spin in AddFlow.vue, dl-spin in DownloadsTab.vue) are removed.
//
// Reduced-motion: the global `tokens.css` @media (prefers-reduced-motion: reduce)
// rule already zeroes `animation-duration` and `animation-iteration-count`
// app-wide. Under that rule the spinner still renders as a static ring
// (border-top-color arc is visible), so it remains a sensible indicator
// rather than disappearing.
//
// `$attrs` fall-through is enabled (inheritAttrs: true by default). Callers can
// pass `aria-hidden="true"`, `data-testid`, extra classes, etc. directly.

withDefaults(
  defineProps<{
    /** Diameter in pixels. Default: 16. Use 18 for the task-row context. */
    size?: number
  }>(),
  { size: 16 },
)
</script>

<template>
  <span
    class="spinner"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.spinner {
  display: inline-block;
  flex-shrink: 0;
  border: 2px solid var(--spinner-track);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spinner-spin 0.7s linear infinite;
}

/* Single shared keyframe — replaces addflow-spin + dl-spin. */
@keyframes spinner-spin {
  to { transform: rotate(360deg); }
}
</style>
