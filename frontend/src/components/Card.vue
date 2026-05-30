<script setup lang="ts">
// Neo-Brutalism surface: cream-paper, hard border + offset shadow. The base
// container every tab composes (task rows, health sections, search results).
//
// `variant` is the elevation tier (#101 D) — elevation now *expresses
// importance* instead of every card sitting at the same height:
//   • hero   — the one prominent surface per screen (strong border, deep
//              shadow, larger radius + padding).
//   • raised — the default working card (border + medium shadow).
//   • flat   — a receding grouped panel (border, NO shadow); its children are
//              divided by --hairline rows so a group reads as one quiet card,
//              not a stack of identical bordered boxes.
// `tone` paints an accent strip along the top; `interactive` adds the
// mechanical press (pushes into its shadow on tap).
import type { Tone } from './tones'

type Variant = 'flat' | 'raised' | 'hero'

withDefaults(
  defineProps<{
    tone?: Tone
    variant?: Variant
    interactive?: boolean
  }>(),
  { tone: 'default', variant: 'raised', interactive: false },
)
</script>

<template>
  <div
    class="card"
    :class="[`tone-${tone}`, `v-${variant}`, { interactive, 'nb-pressable': interactive }]"
  >
    <slot />
  </div>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-4);
}

/* ── Elevation tiers (#101 D) ── */
/* raised is the base above; flat & hero re-map border/shadow/radius. */
.v-flat {
  box-shadow: none;
}
.v-hero {
  border: var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

/* Accent strip — a thick coloured bar hugging the top edge. */
.card:not(.tone-default)::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 6px;
  border-bottom: var(--border-thin) solid var(--ink);
}
.tone-red::before {
  background: var(--red);
}
.tone-orange::before {
  background: var(--orange);
}
.tone-yellow::before {
  background: var(--yellow);
}
.tone-green::before {
  background: var(--green);
}
.tone-violet::before {
  background: var(--violet);
}

/* Press handled by the shared .nb-pressable utility (added when interactive). */
.card.interactive {
  cursor: pointer;
}
</style>
