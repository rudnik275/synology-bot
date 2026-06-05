<script setup lang="ts">
// Home hub — the root screen of the hub-and-spoke IA (ADR 0015, S1 #222).
//
// S1 SCOPE: a MINIMAL hub — three plain, full-width tappable rows (Загрузки /
// NAS / Шоу) that route into the matching full-screen section. The rich
// "dashboard rows" with live summaries (Variant B) are a SEPARATE slice
// (S2 #223); this is intentionally a plain menu so the structural tracer —
// hub root → section → native Back → hub — is demoable on its own.
//
// Emits `navigate` with the chosen SectionKey; the App shell pushes that
// section onto the nav stack. No data, no polling here.
import Card from './ui/Card.vue'
import type { SectionKey } from '../sections'
import ScreenHeader from './ui/ScreenHeader.vue'

defineEmits<{ navigate: [SectionKey] }>()

const ROWS: { key: SectionKey; label: string }[] = [
  { key: 'downloads', label: 'Загрузки' },
  { key: 'nas', label: 'NAS' },
  { key: 'shows', label: 'Шоу' },
]
</script>

<template>
  <div class="hub">
    <ScreenHeader title="Главная" />

    <ul class="hub-rows">
      <li v-for="row in ROWS" :key="row.key">
        <Card
          interactive
          class="hub-row"
          role="button"
          tabindex="0"
          :data-testid="`hub-row-${row.key}`"
          :aria-label="row.label"
          @click="$emit('navigate', row.key)"
          @keydown.enter="$emit('navigate', row.key)"
        >
          <span class="hub-row-label">{{ row.label }}</span>
          <span class="hub-row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </Card>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hub {
  padding: var(--space-4);
}

.hub-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.hub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 56px;
}

.hub-row-label {
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hub-row-chevron svg {
  display: block;
  width: 22px;
  height: 22px;
  opacity: 0.5;
}
</style>
