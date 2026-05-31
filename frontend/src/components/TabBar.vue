<script setup lang="ts">
// Bottom navigation — Downloads / NAS / Shows (ADR 0006 jobs-first IA). Rendered
// as a FLOATING segmented pill spanning ~90% of the screen width, raised over the
// cream dot-grid (paper surface + offset shadow) rather than a full-bleed footer.
// The three segments split the width equally; a yellow indicator block slides
// between them to mark the active tab. Each item keeps icon + label (icon-only
// nav harms discoverability). Default tab is Downloads (set by the shell).
import { computed } from 'vue'
import type { TabKey } from './tabs'

const props = defineProps<{ modelValue: TabKey }>()
defineEmits<{ 'update:modelValue': [TabKey] }>()

const TABS: { key: TabKey; label: string }[] = [
  { key: 'downloads', label: 'Downloads' },
  { key: 'nas', label: 'NAS' },
  { key: 'shows', label: 'Shows' },
]

// Drives the sliding indicator: translateX = activeIndex * one-segment width.
const activeIndex = computed(() => TABS.findIndex((t) => t.key === props.modelValue))
</script>

<template>
  <nav class="pill" aria-label="Main">
    <div class="track" :style="{ '--active': activeIndex }">
      <!-- Sliding sticker that sits behind the segments and tracks the active one. -->
      <span class="indicator" aria-hidden="true" />
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="seg"
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
    </div>
  </nav>
</template>

<style scoped>
/* --- Floating pill: ~90% wide, centred, raised over cream. --- */
.pill {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + var(--space-3));
  transform: translateX(-50%);
  z-index: var(--z-tabbar);
  width: 90%;
  max-width: 520px;
  padding: var(--space-1);
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

/* Flex track: the 3 segments split it equally; it's the positioning context for
 * the indicator so the sticker's 1/3 width + slide line up exactly. */
.track {
  position: relative;
  display: flex;
}

/* The yellow sticker that slides under the active segment. Width = one segment
 * (1/3 of the track); mechanical slide (reduced-motion snaps it via tokens). */
.indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(100% / 3);
  background: var(--yellow);
  border: var(--border);
  border-radius: var(--radius);
  transform: translateX(calc(var(--active) * 100%));
  transition: transform var(--dur-enter) var(--ease-out);
}

.seg {
  position: relative; /* render above the indicator */
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 48px;
  padding: var(--space-2) var(--space-1);
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
  color: var(--ink);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.seg .ico svg {
  width: 24px;
  height: 24px;
  display: block;
}
.seg.active {
  opacity: 1;
}
</style>
