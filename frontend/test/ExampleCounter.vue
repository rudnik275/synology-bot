<script setup lang="ts">
// Trivial component used only to prove the bun-test Vue harness end-to-end
// (SFC compilation + happy-dom mount + reactivity). Not part of the app.
import { ref } from 'vue'

defineProps<{ label: string }>()

const count = ref(0)
</script>

<template>
  <div>
    <p class="label">{{ label }}</p>
    <button @click="count++">count is {{ count }}</button>
  </div>
</template>

<style scoped>
.label {
  color: black;
}
</style>
