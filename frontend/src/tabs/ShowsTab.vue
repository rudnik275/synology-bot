<script setup lang="ts">
// Stub — subscriptions CRUD + today airing (useSubscriptions) is filled by #64.
// Own file so that slice swaps the body cleanly.
import EmptyState from '../components/EmptyState.vue'
</script>

<template>
  <EmptyState title="Shows" message="Tracked shows and today's episodes will appear here.">
    <template #icon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="7" width="18" height="13" rx="1.5" />
        <path d="M8 3l4 4 4-4" />
      </svg>
    </template>
  </EmptyState>
</template>
