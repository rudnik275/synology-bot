<script setup lang="ts">
// Skeleton — dumb shimmer placeholder primitive (Theme 1 sub-issue g, #176).
//
// Renders a single block element with the shimmer keyframe. Size and shape are
// entirely caller-injected via $attrs style / class — no layout props. This
// keeps the primitive maximally reusable without any internal variant branches.
//
// Shimmer palette tokens (defined in tokens.css):
//   --sk-base   quiet fill
//   --sk-sheen  lighter sheen for the sweeping highlight
//   --sk-edge   neutral left-edge stripe (used by DownloadsTab's .sk-edge)
//
// Reduced-motion: the global tokens.css `@media (prefers-reduced-motion: reduce)`
// block sets animation-duration: 0.01ms on * which effectively stops the shimmer.
// The scoped styles here additionally remove the gradient so the element degrades
// to a static flat block with --sk-base fill.
</script>

<template>
  <div class="skeleton" role="presentation" />
</template>

<style scoped>
/* Shimmer keyframe: left → right sweep using background-position. */
@keyframes sk-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

/*
 * Shimmer base: the gradient blends skeleton-base → lighter sheen → skeleton-base,
 * which slides across via background-position animation.
 * Border-radius is caller-controlled via class/style attrs fall-through.
 */
.skeleton {
  display: block;
  border-radius: 6px; /* sensible default; callers override via class or style */
  background: var(--sk-base);
  background-image: linear-gradient(
    90deg,
    var(--sk-base) 0,
    var(--sk-sheen) 40px,
    var(--sk-base) 80px
  );
  background-size: 300px 100%;
  background-repeat: no-repeat;
  animation: sk-shimmer 1.3s linear infinite;
}

/* Reduced motion: freeze the animation and fall back to a static flat tint. */
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    background-image: none;
  }
}
</style>
