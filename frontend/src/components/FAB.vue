<script setup lang="ts">
// Floating action button — the entry point to the Add flow (mounted by #63).
// Fixed bottom-right, clear of the floating pill nav + safe area. Mechanical press.
defineProps<{
  label?: string
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="fab nb-pressable" :aria-label="label ?? 'Добавить'" @click="$emit('click')">
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
  bottom: calc(var(--tabbar-h) + var(--space-5) + var(--safe-bottom));
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
