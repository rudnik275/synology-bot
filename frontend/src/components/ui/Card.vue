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
// `tone` paints an accent strip along the top (legacy NAS/Shows usage).
// `edgeStripe` paints a thin accent stripe down the LEFT side — Variant B
//   pattern for download cards where ONE colour accent reads as the status
//   signal (top strip + badge removed from those cards). The two props are
//   independent; a card can use either, neither, or both.
// `interactive` adds the mechanical press (pushes into its shadow on tap).
import type { Tone } from './tones'

type Variant = 'flat' | 'raised' | 'hero'

withDefaults(
  defineProps<{
    tone?: Tone
    /** Left-edge accent stripe for Variant B download cards (#116). */
    edgeStripe?: Tone
    variant?: Variant
    interactive?: boolean
  }>(),
  { tone: 'default', variant: 'raised', interactive: false },
)
</script>

<template>
  <div
    class="card"
    :class="[`tone-${tone}`, `v-${variant}`, { interactive, 'nb-pressable': interactive, [`stripe-${edgeStripe}`]: !!edgeStripe }]"
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

/* Top accent strip — a thick coloured bar hugging the top edge.
 * Used by NAS/Shows cards. Download cards (Variant B) use the edge stripe
 * instead. Both are independent; neither breaks the other. */
.card:not(.tone-default)::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 6px;
  border-bottom: var(--border-thin) solid var(--ink);
  /* #250 fix 1: match the card's own corner radius so the strip doesn't poke
   * past the rounded corners. Only the top two corners need rounding. */
  border-radius: var(--radius) var(--radius) 0 0;
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

/* ── Variant B: left edge stripe (#116) ──
 * A single thin coloured bar on the left side of the card — ONE status
 * accent only, no top strip + no coloured badge on the card face.
 * The stripe sits on the ::after pseudo-element so it doesn't conflict
 * with the top-strip ::before used by NAS/Shows cards. */
.card[class*='stripe-']::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  border-radius: var(--radius) 0 0 var(--radius);
}
.stripe-red::after {
  background: var(--red);
}
.stripe-orange::after {
  background: var(--orange);
}
.stripe-yellow::after {
  background: var(--yellow);
}
.stripe-green::after {
  background: var(--green);
}
.stripe-violet::after {
  background: var(--violet);
}
.stripe-default::after {
  background: var(--ink);
  opacity: 0.15;
}

/* Press handled by the shared .nb-pressable utility (added when interactive). */
.card.interactive {
  cursor: pointer;
}
</style>
