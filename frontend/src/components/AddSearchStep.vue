<script setup lang="ts">
// Add-flow Step 1: in-app Toloka search (#177, extracted from AddFlow.vue).
//
// Primary in-app entry — skipped on the bot-handoff path. Owns the search field
// (with the recent-search history dropdown in its slot) and the grouped results
// card; the actual search execution + history persistence stay in AddFlow, which
// passes data down as props and receives user actions as events. Behavior and DOM
// (testids, classes) are preserved verbatim so the AddFlow integration net holds.
import SearchBar from './ui/SearchBar.vue'
import Chip from './ui/Chip.vue'
import Skeleton from './ui/Skeleton.vue'
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
      <!-- #213: pinned at the top; only the results list below scrolls.
           The shared SearchBar holds the input + «Поиск» submit in ONE bordered
           frame; the recent-search history is passed via its #dropdown slot. With
           open=true the bar squares its bottom corners and the list butts flush
           against it, so the two read as one combobox (#177 redesign). -->
      <div class="search-row">
        <SearchBar
          id="search-query"
          v-model="searchQuery"
          :loading="searchLoading"
          :open="searchHistoryVisible && filteredHistory.length > 0"
          placeholder="Введите название…"
          inputmode="search"
          enterkeyhint="search"
          data-testid="search-query"
          @search="emit('search')"
          @focus="emit('focus')"
          @blur="emit('blur')"
        >
          <!-- Recent-search history — overlays the bar and hangs off its bottom
               edge. #268 task 04: only open when there are matching items. -->
          <template #dropdown>
            <div
              v-if="searchHistoryVisible && filteredHistory.length > 0"
              class="search-history-dropdown"
              data-testid="search-history"
            >
              <ul class="search-history-list" role="listbox">
                <li
                  v-for="item in filteredHistory"
                  :key="item"
                  class="search-history-item"
                  data-testid="history-item"
                  role="option"
                  @mousedown.prevent="emit('selectHistory', item)"
                >
                  <svg
                    class="search-history-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span class="search-history-text">{{ item }}</span>
                </li>
              </ul>
              <button
                type="button"
                class="search-history-clear"
                data-testid="search-history-clear"
                @mousedown.prevent="emit('clearHistory')"
              >
                Очистить недавнее
              </button>
            </div>
          </template>
        </SearchBar>
      </div>

      <!-- Loading: skeleton result rows inside the same bordered card the real
           results use, instead of a plain text loader (#268 task 05). -->
      <div
        v-if="searchLoading"
        class="search-results search-results--loading"
        data-testid="search-loading"
        aria-busy="true"
        aria-label="Поиск"
      >
        <div v-for="i in 5" :key="i" class="result-row result-row--skeleton">
          <div class="result-row-content">
            <Skeleton class="sk-result-title" />
            <Skeleton class="sk-result-meta" />
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="searchError" class="search-error" role="alert" data-testid="search-error">
        {{ searchError }}
      </div>

      <!-- Empty — inside the same bordered card as the results list, so it fills
           the full height and reads as one consistent surface instead of a stray
           line of grey text. UX: message + a recovery hint, not a dead end. -->
      <div
        v-else-if="searchQueried && searchResults.length === 0"
        class="search-results search-results--empty"
        data-testid="search-empty"
      >
        <div class="search-empty-inner">
          <svg
            class="search-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <p class="search-empty-title">Ничего не найдено</p>
          <p class="search-empty-hint" data-testid="search-empty-hint">Попробуйте изменить запрос</p>
        </div>
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

/* #213: pin the search row at the top of the step. position:sticky also anchors
   the SearchBar, whose relative box anchors the absolutely-positioned history
   dropdown, so the dropdown overlays the scrolling results rather than pushing
   them. The segmented-bar chrome itself lives in SearchBar.vue. */
.search-row {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--cream);
  padding-bottom: var(--space-2);
}

.search-error {
  padding: var(--space-2) var(--space-3);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

/* ── Recent-search dropdown — unified combobox (redesign) ─────────────────────
   The list reads as a downward continuation of the search bar: the SAME 3px ink
   outline + shadow-sm as the input (not the old 5px / shadow-md that read as a
   detached, heavier box), top corners squared so it butts flush against the bar.
   It overlaps the bar's bottom edge by the border width and sits above it (z-100),
   so the bar's squared bottom border is covered and there is ONE 3px divider
   between input and list — no gap, no doubled line. The bar squares its own
   bottom corners while open (SearchBar's .search-frame--open). */
.search-history-dropdown {
  position: absolute;
  top: calc(100% - var(--border-thin)); /* overlap the bar's bottom edge */
  left: 0;
  right: 0; /* spans the full bar width */
  background: var(--paper);
  border: var(--border); /* 3px ink — matches the input frame, not 5px */
  border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: var(--shadow-sm); /* 3px offset — matches the input, not shadow-md */
  z-index: 100;
  overflow: hidden;
}

.search-history-list {
  list-style: none;
  margin: 0;
  padding: var(--space-1) 0;
}

.search-history-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.search-history-item:hover {
  background: var(--yellow);
}

/* Leading recency glyph — quiet, so the query text leads. */
.search-history-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  opacity: 0.4;
}

.search-history-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer clear — a quiet, full-width action under a hairline, replacing the old
   header row (НЕДАВНЕЕ + ОЧИСТИТЬ) that competed with the input for weight. */
.search-history-clear {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-top: var(--hairline);
  background: none;
  cursor: pointer;
  font-family: var(--font);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  opacity: 0.55;
  text-align: center;
}
.search-history-clear:hover {
  opacity: 1;
}

/* ── Results list (Variant B, #121) ── */

/* Outer container: a bordered "card" wrapping the scrolling list. #213: this is
   the single scroll region of step 1 — the pinned search row stays put while the
   results list scrolls under it. */
.search-results {
  /* #268 task 05: restore the bordered-box chrome that #11 dropped — the user
     wants the black-bordered card back. With the inner-scroll fix (#12) the
     bottom border frames the scrolling list instead of reading as a stray
     artifact; the row hairline dividers carry the internal structure. */
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden auto;
  background: var(--paper);
  box-shadow: var(--shadow-sm);
  flex: 1;
  min-height: 0;
}

/* Loading variant: the same framed card, now filling the full height like the
   real list (flex:1) so the skeleton occupies the whole screen instead of a
   short content-sized block (user request). No inner scroll while loading. */
.search-results--loading {
  flex: 1;
  overflow: hidden;
}
.result-row--skeleton {
  pointer-events: none;
}

/* Empty variant: reuse the bordered results card (so it fills the full height —
   flex:1 from .search-results) and center a sticker-icon + message + recovery
   hint inside it, instead of a stray line of grey text. */
.search-results--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.search-empty-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-4);
}
.search-empty-icon {
  width: 44px;
  height: 44px;
  color: var(--ink);
  opacity: 0.55;
}
.search-empty-title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.search-empty-hint {
  margin: 0;
  font-size: var(--fs-sm);
  opacity: 0.6;
}
.sk-result-title {
  height: 14px;
  width: 60%;
}
.sk-result-meta {
  height: 11px;
  width: 38%;
  margin-top: 6px;
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
