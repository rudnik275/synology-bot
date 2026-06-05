<script setup lang="ts">
// Add-flow Step 1: in-app Toloka search (#177, extracted from AddFlow.vue).
//
// Primary in-app entry — skipped on the bot-handoff path. Owns the search field
// (with the recent-search history dropdown in its slot) and the grouped results
// card; the actual search execution + history persistence stay in AddFlow, which
// passes data down as props and receives user actions as events. Behavior and DOM
// (testids, classes) are preserved verbatim so the AddFlow integration net holds.
import SearchField from './ui/SearchField.vue'
import Button from './ui/Button.vue'
import Chip from './ui/Chip.vue'
import LoadingText from './ui/LoadingText.vue'
import type { SearchResultView } from '../types'

defineProps<{
  searchLoading: boolean
  searchError: string | null
  searchQueried: boolean
  searchResults: SearchResultView[]
  searchHistoryVisible: boolean
  filteredHistory: string[]
  searchHistory: string[]
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })

const emit = defineEmits<{
  search: []
  focus: []
  blur: []
  clearHistory: []
  selectHistory: [item: string]
  selectResult: [result: SearchResultView]
}>()

/** Seed-health level for a seeder count. */
function seedHealth(seeders: number): 'green' | 'amber' | 'red' {
  if (seeders >= 20) return 'green'
  if (seeders >= 5) return 'amber'
  return 'red'
}
</script>

<template>
  <div class="step-input">
    <div class="field search-field">
      <label class="field-label" for="search-query">Поиск</label>
      <div class="search-row">
        <SearchField
          id="search-query"
          v-model="searchQuery"
          placeholder="Введите название…"
          data-testid="search-query"
          class="search-row-field"
          @search="emit('search')"
          @focus="emit('focus')"
          @blur="emit('blur')"
        >
          <!-- History dropdown — data/logic stays in AddFlow, slot keeps primitive dumb -->
          <div
            v-if="searchHistoryVisible && (filteredHistory.length > 0 || searchHistory.length > 0)"
            class="search-history-dropdown"
            data-testid="search-history"
          >
            <div class="search-history-header">
              <span class="search-history-label">Недавнее</span>
              <button
                type="button"
                class="search-history-clear"
                data-testid="search-history-clear"
                @mousedown.prevent="emit('clearHistory')"
              >
                Очистить
              </button>
            </div>
            <ul class="search-history-list" role="listbox">
              <li
                v-for="item in filteredHistory"
                :key="item"
                class="search-history-item"
                data-testid="history-item"
                role="option"
                @mousedown.prevent="emit('selectHistory', item)"
              >
                {{ item }}
              </li>
            </ul>
          </div>
        </SearchField>
        <Button
          variant="ink"
          size="md"
          class="search-btn"
          data-testid="search-btn"
          :disabled="searchLoading"
          @click="emit('search')"
        >
          {{ searchLoading ? '…' : 'Поиск' }}
        </Button>
      </div>

      <!-- Loading -->
      <LoadingText
        v-if="searchLoading"
        class="search-loading"
        data-testid="search-loading"
      />

      <!-- Error -->
      <div v-else-if="searchError" class="search-error" role="alert" data-testid="search-error">
        {{ searchError }}
      </div>

      <!-- Empty results -->
      <div v-else-if="searchQueried && searchResults.length === 0" class="search-empty" data-testid="search-empty">
        Ничего не найдено
      </div>

      <!-- Results — grouped card with hairline dividers (Variant B, #121) -->
      <div v-else-if="searchResults.length > 0" class="search-results" role="list" data-testid="search-results">
        <button
          v-for="result in searchResults"
          :key="result.id"
          type="button"
          class="result-row nb-pressable"
          role="listitem"
          :data-testid="`result-${result.id}`"
          @click="emit('selectResult', result)"
        >
          <div class="result-row-content">
            <span class="result-title" data-testid="result-title">{{ result.title }}</span>
            <span class="result-meta">
              <Chip
                v-if="result.quality && result.quality.length > 0"
                variant="outlined"
                data-testid="result-quality"
              >{{ result.quality[0] }}</Chip>
              <span class="result-health" :data-health="seedHealth(result.seeders)">
                <span class="result-health-dot" :class="`result-health-dot--${seedHealth(result.seeders)}`" aria-hidden="true"></span>
                <span data-testid="result-seeders">{{ result.seeders }}</span>
              </span>
              <span class="result-size" data-testid="result-size">{{ result.size }}</span>
            </span>
          </div>
          <svg class="result-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Step 1: Search input ── */
/* #213: the search row is pinned at the top; only the results list scrolls.
   The step is a flex column filling the wizard body so the inner results area
   can own its own scroll region. */
.step-input {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.field {
  margin-bottom: var(--space-4);
}

.field-label {
  display: block;
  margin-bottom: var(--space-1);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Search */
.search-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* Fill the step so the results region below can scroll independently (#213).
     The .field margin-bottom is dropped here — the column owns the spacing. */
  flex: 1;
  min-height: 0;
  margin-bottom: 0;
}

/* #213: pin the search row at the top of the step. The history dropdown is
   absolutely positioned relative to the SearchField, so it overlays the
   scrolling results below rather than pushing them. */
.search-row {
  display: flex;
  gap: var(--space-2);
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--cream);
  padding-bottom: var(--space-2);
}

.search-row-field {
  flex: 1;
  min-width: 0; /* prevent flex child from overflowing its container (#10) */
}

/* Layout only — the recipe lives in the shared <Button variant="ink">. */
.search-btn {
  white-space: nowrap;
}

.search-loading,
.search-empty {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--fs-sm);
  opacity: 0.7;
}

.search-error {
  padding: var(--space-2) var(--space-3);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* Search history dropdown */
.search-history-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0; /* spans the full SearchField width; the Search button is outside */
  background: var(--paper);
  border: var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 100;
  overflow: hidden;
}

.search-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-3);
  border-bottom: var(--border);
}

.search-history-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
}

.search-history-clear {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  color: var(--ink);
}
.search-history-clear:hover {
  opacity: 1;
}

.search-history-list {
  list-style: none;
  margin: 0;
  padding: var(--space-1) 0;
}

.search-history-item {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-history-item:hover {
  background: var(--yellow);
}

/* ── Grouped results card (Variant B, #121) ── */

/* Outer container: single border, single shadow — the "one grouped card".
   #213: this is the single scroll region of step 1 — the pinned search row
   stays put while the results list scrolls under it. overflow-y:auto forces
   overflow-x, so a thin side padding keeps the row shadows from being clipped. */
.search-results {
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden auto;
  background: var(--paper);
  box-shadow: var(--shadow-sm);
  flex: 1;
  min-height: 0;
}

/* Each row is a full-width button with a hairline divider beneath it */
.result-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px; /* touch target */
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--hairline-color);
  border-radius: 0;
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  color: var(--ink);
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical),
    background var(--dur-fast) var(--ease-out);
}
.result-row:last-child {
  border-bottom: none;
}
.result-row:active {
  background: var(--ink-active);
}

/* Content column: takes all remaining width */
.result-row-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Title: bold, single line, ellipsis */
.result-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Meta row: quality chip + seed health + size */
.result-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

/* Seed-health indicator: dot + count */
.result-health {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: var(--fw-bold);
  flex-shrink: 0;
}

.result-health-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--ink);
  flex-shrink: 0;
}
.result-health-dot--green  { background: var(--green); }
.result-health-dot--amber  { background: var(--orange); }
.result-health-dot--red    { background: var(--red); }

/* File size */
.result-size {
  font-size: 10px;
  font-weight: var(--fw-bold);
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Chevron affordance */
.result-chevron {
  width: 16px;
  height: 16px;
  opacity: 0.4;
  flex-shrink: 0;
}
</style>
