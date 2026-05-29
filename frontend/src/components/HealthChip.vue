<script setup lang="ts">
// Ambient NAS-health chip in the header (ADR 0006): a status dot + one metric,
// present on every tab; tap jumps to the NAS tab. This slice ships the visual
// scaffold only — real status/metric are wired by #70 (useHealth). Default
// status is `unknown` (grey) until that lands.
export type HealthStatus = 'ok' | 'warn' | 'bad' | 'unknown'

withDefaults(
  defineProps<{
    status?: HealthStatus
    /** Short metric, e.g. "62% disk". Em-dash placeholder until #70 wires data. */
    metric?: string
  }>(),
  { status: 'unknown', metric: '—' },
)

defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="chip" :class="`status-${status}`" aria-label="NAS health" @click="$emit('click')">
    <span class="dot" :class="{ pulse: status !== 'unknown' }" />
    <span class="metric">{{ metric }}</span>
  </button>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-3);
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  color: var(--ink);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.chip:active {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-none);
}
.dot {
  width: 12px;
  height: 12px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  background: var(--idle);
  flex: none;
}
.status-ok .dot {
  background: var(--ok);
}
.status-warn .dot {
  background: var(--warn);
}
.status-bad .dot {
  background: var(--bad);
}
.metric {
  font-variant-numeric: tabular-nums;
}
.dot.pulse {
  animation: chip-pulse 2s var(--ease-out) infinite;
}
@keyframes chip-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
