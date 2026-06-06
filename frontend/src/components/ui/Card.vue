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

/* ── Variant B: coloured LEFT EDGE (#116) ──
 * The status accent IS the card's own left border, thickened to --border-thick
 * and tinted — so it follows the rounded corners exactly. Earlier takes drew a
 * separate bar: inside the border it got clipped at the corners (#267 task 02);
 * flush-outside the border it poked past the card outline and looked broken
 * (round-2). A coloured border can do neither — no clip, no poke-out. The top
 * strip (::before) used by NAS/Shows cards is independent and untouched. */
.card[class*='stripe-'] {
  border-left-width: var(--border-thick);
}
.stripe-red    { border-left-color: var(--red); }
.stripe-orange { border-left-color: var(--orange); }
.stripe-yellow { border-left-color: var(--yellow); }
.stripe-green  { border-left-color: var(--green); }
.stripe-violet { border-left-color: var(--violet); }
.stripe-default { border-left-color: var(--idle); }

/* Press handled by the shared .nb-pressable utility (added when interactive). */
.card.interactive {
  cursor: pointer;
}
</style>
