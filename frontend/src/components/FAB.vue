<script setup lang="ts">
// Floating action button — the entry point to the Add flow (mounted by #63).
// Fixed bottom-right, clear of the tab bar + safe area. Mechanical press.
defineProps<{
  label?: string
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="fab" :aria-label="label ?? 'Add'" @click="$emit('click')">
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
  bottom: calc(var(--tabbar-h) + var(--space-4) + env(safe-area-inset-bottom, 0px));
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
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.fab svg {
  width: 28px;
  height: 28px;
}
.fab:active {
  transform: translate(4px, 4px);
  box-shadow: var(--shadow-none);
}
</style>
