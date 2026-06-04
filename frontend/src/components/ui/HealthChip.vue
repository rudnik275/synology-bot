<script setup lang="ts">
// HealthChip — ambient NAS health indicator for the app header (ADR 0006 / #182).
//
// Dumb-ish presentational component: takes `status` and `metric` as props so
// App.vue can wire them from useHealth(). Tap emits `select` — navigation to
// the NAS tab is the caller's responsibility. No internal routing.
//
// Color-not-only (ADR 0006 a11y): each status has a labeled text cue in
// addition to the colored dot, so colorblind users and screen-readers can
// distinguish states without relying on color alone.
//
// Reduced-motion: the pulse animation is governed by the global @media rule in
// tokens.css — no per-component override needed.
import type { HealthStatus } from '../health'

const props = defineProps<{
  status: HealthStatus
  metric: string
}>()

defineEmits<{ select: [] }>()

// Text cue per status (color-not-only requirement, ADR 0006).
const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: 'OK',
  warn: 'Warn',
  bad: 'Critical',
  unknown: 'Connecting',
}
</script>

<template>
  <button
    type="button"
    class="health-chip"
    :aria-label="`NAS health: ${STATUS_LABEL[props.status]} — ${props.metric}`"
    @click="$emit('select')"
  >
    <!-- Severity dot: color cue -->
    <span class="dot" :class="`dot--${props.status === 'unknown' ? 'idle' : props.status}`" aria-hidden="true" />
    <!-- Text cue: status label (color-not-only) -->
    <span class="status-label">{{ STATUS_LABEL[props.status] }}</span>
    <!-- Metric: busiest volume like "volume1 72%" -->
    <span class="metric">{{ props.metric }}</span>
  </button>
</template>

<style scoped>
/* ── Root: pressable pill strip in the header ── */
.health-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  line-height: 1;
  color: var(--ink);
  background: var(--ink-chip-bg);
  border: var(--border-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  cursor: pointer;
  white-space: nowrap;
  /* Pressable: tap sinks the chip into its own (minimal) shadow. */
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical),
    opacity var(--dur-fast) var(--ease-out);
}
.health-chip:active {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-none);
}

/* ── Severity dot ── */
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: var(--border-thin) solid var(--ink);
  flex-shrink: 0;
}

/* Traffic-light triad — warn is amber (--warn / --orange), NOT yellow.
   Yellow is reserved for primary actions (#101 accent split). */
.dot--ok   { background: var(--ok);   }
.dot--warn { background: var(--warn); }
.dot--bad  { background: var(--bad);  }
.dot--idle { background: var(--idle); }

/* ── Status label: the color-not-only text cue ── */
.status-label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}

/* ── Metric: the one data value ("volume1 72%") ── */
.metric {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
</style>
