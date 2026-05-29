<script setup lang="ts">
// Stub — live NAS health data (useHealth + GET /api/health, header health-chip
// data) is wired by #70. Own file so that slice swaps the body cleanly.
import EmptyState from '../components/EmptyState.vue'
</script>

<template>
  <EmptyState title="NAS" message="Disk, memory and CPU health will appear here.">
    <template #icon>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="7" rx="1.5" />
        <rect x="3" y="13" width="18" height="7" rx="1.5" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </svg>
    </template>
  </EmptyState>
</template>
