<script setup lang="ts">
// Bottom 3-tab bar — Downloads / NAS / Shows (ADR 0006 jobs-first IA). Default
// tab is Downloads (set by the shell, not here). Active tab is highlighted; each
// item carries icon + label (icon-only nav harms discoverability).
import type { TabKey } from './tabs'

defineProps<{ modelValue: TabKey }>()
defineEmits<{ 'update:modelValue': [TabKey] }>()

const TABS: { key: TabKey; label: string }[] = [
  { key: 'downloads', label: 'Downloads' },
  { key: 'nas', label: 'NAS' },
  { key: 'shows', label: 'Shows' },
]
</script>

<template>
  <nav class="tabbar" aria-label="Main">
    <button
      v-for="tab in TABS"
      :key="tab.key"
      type="button"
      class="tab"
      :class="{ active: modelValue === tab.key }"
      :aria-current="modelValue === tab.key ? 'page' : undefined"
      @click="$emit('update:modelValue', tab.key)"
    >
      <span class="ico" aria-hidden="true">
        <!-- Downloads: arrow into tray -->
        <svg v-if="tab.key === 'downloads'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <!-- NAS: stacked drives -->
        <svg v-else-if="tab.key === 'nas'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </svg>
        <!-- Shows: tv -->
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </span>
      <span class="label">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-tabbar);
  display: flex;
  height: calc(var(--tabbar-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--cream);
  border-top: var(--border-strong);
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  padding: var(--space-1);
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ink);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.tab .ico svg {
  width: 24px;
  height: 24px;
  display: block;
}
.tab.active {
  opacity: 1;
}
/* Active tab gets the sticker treatment: a filled accent block under it. */
.tab.active .ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 30px;
  background: var(--yellow);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
</style>
