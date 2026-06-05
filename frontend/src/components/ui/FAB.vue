<script setup lang="ts">
// Floating action button — global Add entry point (ADR 0015, S3 #224).
// Fixed bottom-right, clear of the device safe area. No tab bar anymore (ADR 0015).
// Mechanical press.
defineProps<{
  label?: string
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="fab nb-pressable" data-testid="global-fab" :aria-label="label ?? 'Добавить'" @click="$emit('click')">
    <slot>
      <!-- default plus glyph -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </slot>
  </button>
</template>

<style scoped>
.fab {
  position: fixed;
  right: var(--space-4);
  /* No tab bar anymore (ADR 0015) — clear only the device safe area + breathing room. */
  bottom: calc(var(--safe-bottom) + var(--space-4));
  z-index: var(--z-fab);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  padding: 0;
  color: var(--ink);
  background: var(--yellow);
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  /* Press handled by .nb-pressable; FAB sinks 4px (its own deep shadow). */
  --press: 4px;
}
.fab svg {
  width: 28px;
  height: 28px;
}
</style>
