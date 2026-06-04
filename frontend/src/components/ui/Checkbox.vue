<script setup lang="ts">
// Checkbox — dumb Neo-Brutalism square checkbox primitive (Theme 1 sub-issue f, #176).
// Extracted from TreeNode.vue's `.ck` block.
//
// Supports: checked / indeterminate / disabled states.
// Emits 'change' with the new boolean value on click (unless disabled).
//
// Everything else (data-testid, aria-label, @click.stop, extra classes) falls through
// to the native <button> via $attrs, so call sites keep their test hooks unchanged.

const props = withDefaults(
  defineProps<{
    checked?: boolean
    indeterminate?: boolean
    disabled?: boolean
  }>(),
  { checked: false, indeterminate: false, disabled: false },
)

const emit = defineEmits<{ change: [value: boolean] }>()

function handleClick(): void {
  if (props.disabled) return
  emit('change', !props.checked)
}
</script>

<template>
  <button
    type="button"
    class="ck"
    :class="{ 'ck--on': checked && !indeterminate, 'ck--some': indeterminate }"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : checked"
    :disabled="disabled || undefined"
    @click="handleClick"
  >
    <svg v-if="checked && !indeterminate" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 13l4 4 10-10" />
    </svg>
    <span v-else-if="indeterminate" class="dash" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
/* Square Neo-Brutalism checkbox — pixel-identical to TreeNode.vue's .ck block. */
.ck {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border: 2px solid var(--ink);
  border-radius: 6px;
  background: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.ck--on {
  background: var(--yellow);
}
.ck--some {
  background: var(--yellow);
}
.ck svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--ink);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ck .dash {
  width: 10px;
  height: 3px;
  background: var(--ink);
  border-radius: 2px;
}
</style>
