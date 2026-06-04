<script setup lang="ts">
// Centered empty/placeholder state. Tabs use this for "no downloads",
// "no subscriptions", and (in this foundation slice) the stubbed tab bodies.
defineProps<{
  title: string
  message?: string
}>()
</script>

<template>
  <div class="empty">
    <div class="icon"><slot name="icon" /></div>
    <h2 class="title">{{ title }}</h2>
    <p v-if="message" class="message">{{ message }}</p>
    <div v-if="$slots.action" class="action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
  min-height: 50dvh;
}
.icon :deep(svg) {
  width: 56px;
  height: 56px;
  stroke: var(--ink);
}
.title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.message {
  margin: 0;
  max-width: 32ch;
  color: var(--ink);
  opacity: 0.7;
}
.action {
  margin-top: var(--space-2);
}
</style>
