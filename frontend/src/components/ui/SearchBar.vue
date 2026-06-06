<script setup lang="ts">
// SearchBar — the segmented search recipe shared by the add-flow search step and
// the Shows tab: ONE bordered frame holding a leading magnifier, a bare input,
// and a coral «Поиск» submit. Extracted from AddSearchStep so both screens use
// the exact same control (one source of truth for the chrome + behaviour).
//
// .nb-framed paints the black outline as an inset overlay and clips children to
// the rounded corners, so the coral segment reaches the corner with NO sliver.
//
// `open` squares the frame's bottom corners and holds the small shadow so a
// recent-search list (passed via the #dropdown slot) can butt flush against the
// bar below and read as one combobox. Without a dropdown, leave `open` false.
//
// Dumb-primitive rule: NO baked-in focus/blur/commit logic. The consumer injects
// behaviour via @focus / @blur / @search. Input attrs (placeholder, data-testid,
// inputmode, enterkeyhint, id, type) fall through to the inner SearchField.
import SearchField from './SearchField.vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    /** Disables the submit + shows a «…» label while a search is in flight. */
    loading?: boolean
    /** Submit-button caption. */
    label?: string
    /** Square the bottom corners so a #dropdown list attaches flush below. */
    open?: boolean
  }>(),
  { loading: false, label: 'Поиск', open: false },
)

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  search: []
  focus: []
  blur: []
}>()
</script>

<template>
  <div class="search-bar">
    <div class="search-frame nb-framed" :class="{ 'search-frame--open': open }">
      <svg
        class="search-frame-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <SearchField
        v-bind="$attrs"
        v-model="model"
        bare
        class="search-row-field"
        @search="emit('search')"
        @focus="emit('focus')"
        @blur="emit('blur')"
      />
      <button
        type="button"
        class="search-submit"
        data-testid="search-btn"
        :disabled="loading"
        @click="emit('search')"
      >
        {{ loading ? '…' : label }}
      </button>
    </div>

    <!-- Overlays (e.g. the recent-search combobox) anchor to this relative box,
         so they hang directly off the frame's bottom edge. -->
    <slot name="dropdown" />
  </div>
</template>

<style scoped>
/* Relative anchor for an absolutely-positioned #dropdown overlay. */
.search-bar {
  position: relative;
}

/* ── Segmented search bar ─────────────────────────────────────────────────────
   ONE bordered frame: leading magnifier · bare input · coral «Поиск» submit.
   The hard drop shadow lives here and lifts on focus (replacing the standalone
   field's focus shadow). */
.search-frame {
  display: flex;
  align-items: stretch;
  background: var(--paper);
  box-shadow: var(--shadow-sm);
}
.search-frame:focus-within {
  box-shadow: var(--shadow-md);
}

/* Combobox open: the recent-search list butts flush against the bar below, so
   square the bottom corners and hold the small shadow (don't grow to shadow-md)
   so the bar + list read as one 3px-outlined control. .nb-framed::after inherits
   the squared radius; its bottom edge is covered by the overlapping dropdown. */
.search-frame--open,
.search-frame--open:focus-within {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  box-shadow: var(--shadow-sm);
}

.search-frame-icon {
  flex-shrink: 0;
  align-self: center;
  width: 20px;
  height: 20px;
  margin-left: var(--space-3);
  color: var(--ink);
  opacity: 0.5;
}

.search-row-field {
  flex: 1;
  min-width: 0; /* prevent flex child from overflowing its container (#10) */
}

/* SearchField sets inheritAttrs:false, so the `.search-row-field` class above
   lands on the inner <input>, NOT the component root. Grow the ROOT so the bare
   input expands to fill the gap between the icon and the submit segment. */
.search-frame :deep(.search-field-root) {
  flex: 1 1 auto;
  min-width: 0;
}
/* The icon already supplies the left inset, so the bare input needs only a small
   gap from it (not its full default left padding). */
.search-frame :deep(.search-field-input) {
  padding-left: var(--space-2);
}

/* Coral submit segment — full-bleed fill (the frame clips it to the rounded
   corner), divided from the input by a 3px ink hairline matching the frame
   weight. Mechanical press would be clipped, so press = a brightness dip. */
.search-submit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 var(--space-4);
  background: var(--coral);
  color: var(--ink);
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: none;
  border-left: var(--border);
  border-radius: 0;
  cursor: pointer;
  white-space: nowrap;
  transition: filter var(--dur-fast) var(--ease-out);
}
.search-submit:active:not(:disabled) {
  filter: brightness(0.92);
}
.search-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
