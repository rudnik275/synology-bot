<script setup lang="ts">
// LoadingText — inline loading indicator: Spinner + label.
//
// Default label is "Загрузка…" (user-facing strings stay Russian per project rules).
// Pass `label` to override (e.g. "Поиск…" for search flows).
// Pass `size` to control the inner spinner diameter (default 16).
//
// $attrs fall-through goes to the root element so callers can attach
// data-testid, extra classes, aria attributes, etc.

import Spinner from './Spinner.vue'

withDefaults(
  defineProps<{
    /** Override the label text. Default: "Загрузка…" */
    label?: string
    /** Spinner size in px. Threads through to Spinner. Default: 16. */
    size?: number
  }>(),
  { label: 'Загрузка…', size: 16 },
)
</script>

<template>
  <div class="loading-text">
    <Spinner :size="size" aria-hidden="true" />
    {{ label }}
  </div>
</template>

<style scoped>
.loading-text {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  opacity: 0.75;
}
</style>
