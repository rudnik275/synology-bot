<script setup lang="ts">
// The one Neo-Brutalism button (#101 item A). Owns the bold-uppercase CTA
// recipe + the mechanical press (via the shared .nb-pressable utility) so the
// recipe lives in exactly one place instead of being re-declared per tab.
//
// `variant` carries colour + weight (primary reads heaviest: strong border,
// deeper shadow, 5px press — that's the primary-vs-secondary hierarchy item A
// asks for). `size` carries dimensions only (font-size / padding / height).
//
// Everything else (data-testid, :disabled, @click, aria-*) falls through to the
// native <button> via $attrs, so call sites keep their test hooks unchanged.
type Variant = 'primary' | 'neutral' | 'ink' | 'warning' | 'success' | 'danger'
type Size = 'sm' | 'md' | 'lg'

withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { variant: 'neutral', size: 'md', type: 'button' },
)
</script>

<template>
  <button class="nb-btn nb-pressable" :class="[`v-${variant}`, `s-${size}`]" :type="type">
    <slot />
  </button>
</template>

<style scoped>
.nb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  border-radius: var(--radius);
  cursor: pointer;
  user-select: none;
}
.nb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Size: dimensions only ── */
.s-sm {
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
}
.s-md {
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
}
.s-lg {
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--fs-md);
}

/* ── Variant: colour + weight/elevation ── */
.v-neutral {
  background: var(--cream);
  border: var(--border);
  box-shadow: var(--shadow-sm);
}
.v-warning {
  background: var(--yellow);
  border: var(--border);
  box-shadow: var(--shadow-sm);
}
.v-success {
  background: var(--green);
  border: var(--border);
  box-shadow: var(--shadow-sm);
}
.v-danger {
  background: var(--red);
  border: var(--border);
  box-shadow: var(--shadow-sm);
}
.v-ink {
  background: var(--ink);
  color: var(--cream);
  border: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
/* Primary is the heaviest: strong border + deeper shadow + matching 5px press. */
.v-primary {
  background: var(--yellow);
  border: var(--border-strong);
  box-shadow: var(--shadow-md);
  --press: 5px;
}
</style>
