<script setup lang="ts">
// One oversized screen heading per tab (#101 item C — the top of the type
// hierarchy). Shared so Downloads / NAS / Shows read consistently.
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="screen-header">
    <h1 class="screen-title">{{ title }}</h1>
    <p v-if="subtitle" class="screen-sub">{{ subtitle }}</p>
  </header>
</template>

<style scoped>
.screen-header {
  margin-bottom: var(--space-3);
}
.screen-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  line-height: 1;
}
.screen-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
}
</style>
