<script setup lang="ts">
// SearchField — dumb input primitive (Theme 1 sub-issue d, #176).
//
// Owns the Neo-Brutalist input recipe (paper bg + border-strong + shadow + focus ring)
// shared between ShowsTab's pinned search field and AddFlow's search step.
//
// Dumb primitive rule: NO baked-in focus/blur logic. All varying behavior (history
// dropdown visibility, keyboard-dismiss on commit, etc.) is injected from the call
// site via @focus / @blur / @search events. Consumers keep their own behavior.
//
// v-model: modelValue / update:modelValue (string).
// Attrs fall-through: placeholder, data-testid, aria-*, inputmode, enterkeyhint, type.
// Default slot: for overlays like the history dropdown (kept in the consumer).

defineOptions({ inheritAttrs: false })

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  search: [event: KeyboardEvent]
}>()
</script>

<template>
  <div class="search-field-root">
    <input
      v-bind="$attrs"
      class="search-field-input"
      :value="modelValue"
      autocomplete="off"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
      @keydown.enter="emit('search', $event)"
    />
    <slot />
  </div>
</template>

<style scoped>
.search-field-root {
  position: relative;
}

.search-field-input {
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--ink);
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  outline: none;
  box-sizing: border-box;
  /* Static neo-brutal shadow matching the show rows/folder tiles (#6 fix). */
  box-shadow: var(--shadow-sm);
}

.search-field-input:focus {
  box-shadow: var(--shadow-md);
}
</style>
