<script setup lang="ts">
// Chip — dumb presentational pill primitive (Theme 1 sub-issue c, #176).
//
// Three visual variants covering the three duplicated chip recipes:
//   flat     — solid ink-chip-bg pill (AddFlow confirm .chip / bc-chips)
//   outlined — bold border + pill radius, transparent bg (AddFlow .result-chip)
//   tag      — cream bg + thin ink border + square-ish radius + 0.75 opacity
//              (DownloadsTab quality chips under task title)
//
// Attrs fall through to the root <span> so callers keep data-testid, extra classes, etc.
// No internal conditional branches — variation injected entirely via `variant` prop.
type Variant = 'flat' | 'outlined' | 'tag'

withDefaults(
  defineProps<{ variant?: Variant }>(),
  { variant: 'flat' },
)
</script>

<template>
  <span class="chip" :class="`v-${variant}`">
    <slot />
  </span>
</template>

<style scoped>
/* ── Base: structural reset ── */
.chip {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

/* ── flat: solid ink-chip-bg pill ── */
/* Recipe: AddFlow .bc-chips .chip (confirm step) */
.v-flat {
  font-size: 11px;
  font-weight: var(--fw-bold);
  padding: 5px 11px;
  border-radius: var(--radius-pill);
  background: var(--ink-chip-bg);
  color: var(--ink-secondary);
}

/* ── outlined: bold border + pill radius, paper bg ── */
/* Recipe: AddFlow .result-chip (search results quality badge) */
.v-outlined {
  font-size: 10px;
  font-weight: var(--fw-bold);
  padding: 2px 7px;
  border: 2px solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  flex-shrink: 0;
}

/* ── tag: cream bg + thin ink border + rounded (not pill) radius, quieter opacity ── */
/* Recipe: DownloadsTab quality chips (year / resolution / codec / languages) */
.v-tag {
  padding: 1px var(--space-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  background: var(--cream);
  border: var(--border-thin) solid var(--ink);
  border-radius: var(--radius);
  opacity: 0.75;
}
</style>
