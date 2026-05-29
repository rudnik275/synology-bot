<script setup lang="ts">
// Neo-Brutalism surface: cream-paper, hard border + offset shadow. The base
// container every tab composes (task rows, health sections, search results).
// `tone` paints an accent strip along the top; `interactive` adds the
// mechanical press (pushes into its shadow on tap).
import type { Tone } from './tones'

withDefaults(
  defineProps<{
    tone?: Tone
    interactive?: boolean
  }>(),
  { tone: 'default', interactive: false },
)
</script>

<template>
  <div class="card" :class="[`tone-${tone}`, { interactive }]">
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

.card.interactive {
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}
.card.interactive:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
</style>
