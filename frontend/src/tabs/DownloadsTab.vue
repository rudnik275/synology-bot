<script setup lang="ts">
// Stub — the foundation slice (#60) ships the shell only. The live tasks list
// (useTasks + pause/resume/delete) is filled by #61. Kept as its own file so
// that slice swaps the body without touching shared shell/kit files.
import EmptyState from '../components/EmptyState.vue'
</script>

<template>
  <EmptyState title="Downloads" message="Active downloads will appear here.">
    <template #icon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    </template>
  </EmptyState>
</template>
