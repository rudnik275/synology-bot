<script setup lang="ts">
/**
 * Shows tab — search-first around a Show detail page (ADR 0009).
 *
 * Two modes driven by a single search field:
 *   - Empty query → show Subscriptions list (default)
 *   - Non-empty query → show Show search results
 *
 * Tapping any row opens the Show detail sub-view (list hides, detail shows).
 * Subscribe / Unsubscribe lives ONLY on the detail page.
 * The in-app "today" block is removed; daily push covers same-day airings.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSubscriptions } from '../composables/useSubscriptions'
import { useShowSearch } from '../composables/useShowSearch'
import { useShowDetail } from '../composables/useShowDetail'
import ShowDetail from '../components/ShowDetail.vue'
import Card from '../components/ui/Card.vue'
import ScreenHeader from '../components/ui/ScreenHeader.vue'
import StickerBadge from '../components/ui/StickerBadge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SearchField from '../components/ui/SearchField.vue'

const { subscriptions, loading: subsLoading, error: subsError, add, remove, refreshMetadata } = useSubscriptions()
const { results: searchResults, loading: searchLoading, error: searchError, debouncedSearch } = useShowSearch()
const { data: showDetail, loading: detailLoading, error: detailError, load: loadDetail, clear: clearDetail } = useShowDetail()

const query = ref('')
const selectedShowId = ref<number | null>(null)
const subscribing = ref(false)

// On open, kick a background backfill so pre-existing subs (no cached poster/
// episode from before ADR 0009) self-fill within a couple seconds rather than
// waiting for the daily digest. The cached list renders instantly meanwhile.
onMounted(() => {
  void refreshMetadata()
})

// When query changes, trigger debounced search and clear detail
watch(query, (q) => {
  debouncedSearch(q)
  if (selectedShowId.value !== null) {
    selectedShowId.value = null
    clearDetail()
    hideTgBackButton()
  }
})

const isSearchMode = computed(() => query.value.trim().length >= 2)
const hasDetail = computed(() => selectedShowId.value !== null)

const error = computed(() => detailError.value ?? searchError.value ?? subsError.value)

/** Zero-padded SxxEyy string */
function fmtEp(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

// --- Telegram BackButton wiring ---

function showTgBackButton(): void {
  const btn = window.Telegram?.WebApp?.BackButton
  if (!btn) return
  btn.show()
  btn.onClick(handleBack)
}

function hideTgBackButton(): void {
  const btn = window.Telegram?.WebApp?.BackButton
  if (!btn) return
  btn.hide()
  btn.offClick(handleBack)
}

onUnmounted(() => {
  hideTgBackButton()
})

// --- Row tap: open detail ---

async function openShow(showId: number): Promise<void> {
  selectedShowId.value = showId
  await loadDetail(showId)
  showTgBackButton()
}

function handleBack(): void {
  selectedShowId.value = null
  clearDetail()
  hideTgBackButton()
}

// --- Subscribe / Unsubscribe from detail page ---

async function handleSubscribe(): Promise<void> {
  if (!showDetail.value) return
  subscribing.value = true
  try {
    await add(showDetail.value.id)
    // Reload detail to get updated isSubscribed state
    await loadDetail(showDetail.value.id)
  } catch {
    // swallow — refetch keeps list consistent
  } finally {
    subscribing.value = false
  }
}

async function handleUnsubscribe(): Promise<void> {
  if (!showDetail.value) return
  subscribing.value = true
  try {
    await remove(String(showDetail.value.id))
    // Reload detail to get updated isSubscribed state
    await loadDetail(showDetail.value.id)
  } catch {
    // swallow — refetch keeps list consistent
  } finally {
    subscribing.value = false
  }
}
</script>

<template>
  <div class="shows-tab">
    <!-- Show detail sub-view: covers the list -->
    <template v-if="hasDetail">
      <ScreenHeader title="Шоу" />
      <div v-if="detailLoading" class="loading-hint">Загрузка…</div>
      <div v-else-if="detailError" class="fetch-error">{{ detailError }}</div>
      <ShowDetail
        v-else-if="showDetail"
        :show="showDetail"
        :subscribing="subscribing"
        @subscribe="handleSubscribe"
        @unsubscribe="handleUnsubscribe"
      />
    </template>

    <!-- List view (search or subscriptions) -->
    <template v-else>
      <ScreenHeader title="Шоу" />

      <!-- Pinned search field -->
      <div class="search-wrapper">
        <SearchField
          v-model="query"
          data-testid="search-input"
          type="search"
          placeholder="Поиск шоу…"
          @search="(e) => (e.target as HTMLElement).blur()"
        />
      </div>

      <!-- Fetch error banner -->
      <p v-if="error" class="fetch-error">{{ error }}</p>

      <!-- Search results mode -->
      <template v-if="isSearchMode">
        <div v-if="searchLoading" class="loading-hint">Поиск…</div>
        <EmptyState
          v-else-if="!searchLoading && (searchResults?.length ?? 0) === 0"
          title="Ничего не найдено"
          message="Попробуйте другой запрос."
        >
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </template>
        </EmptyState>
        <TransitionGroup v-else tag="ul" name="show-list" class="show-list" appear>
          <li
            v-for="(result, index) in searchResults"
            :key="result.id"
            :data-testid="`search-result-${result.id}`"
            class="show-item"
            :style="{ '--stagger-index': index }"
            role="button"
            tabindex="0"
            @click="openShow(result.id)"
            @keydown.enter="openShow(result.id)"
          >
            <Card>
              <div class="show-row">
                <img v-if="result.poster" :src="result.poster" class="show-thumb" :alt="result.title" />
                <div v-else class="show-thumb-placeholder" aria-hidden="true" />
                <div class="show-info">
                  <span class="show-title">{{ result.title }}</span>
                  <span v-if="result.titleOriginal" class="show-title-orig">{{ result.titleOriginal }}</span>
                </div>
                <StickerBadge v-if="result.isSubscribed" tone="green" class="subscribed-badge">
                  ✓
                </StickerBadge>
              </div>
            </Card>
          </li>
        </TransitionGroup>
      </template>

      <!-- Subscriptions mode (default: empty query) -->
      <template v-else>
        <div v-if="subsLoading" class="loading-hint">Загрузка…</div>

        <EmptyState
          v-else-if="subscriptions.length === 0"
          title="Нет подписок"
          message="Найдите шоу через поиск и подпишитесь."
        >
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="7" width="18" height="13" rx="1.5" />
              <path d="M8 3l4 4 4-4" />
            </svg>
          </template>
        </EmptyState>

        <TransitionGroup v-else tag="ul" name="show-list" class="show-list" appear>
          <li
            v-for="(sub, index) in subscriptions"
            :key="sub.id"
            :data-testid="`subscription-row-${sub.id}`"
            class="show-item"
            :style="{ '--stagger-index': index }"
            role="button"
            tabindex="0"
            @click="openShow(sub.showId)"
            @keydown.enter="openShow(sub.showId)"
          >
            <Card>
              <div class="show-row">
                <img v-if="sub.poster" :src="sub.poster" class="show-thumb" :alt="sub.title" />
                <div v-else class="show-thumb-placeholder" aria-hidden="true" />
                <div class="show-info">
                  <span class="show-title">{{ sub.title }}</span>
                </div>
                <StickerBadge
                  :tone="sub.latestAiredEpisode ? 'green' : 'orange'"
                  class="episode-badge"
                >
                  {{ sub.latestAiredEpisode ? fmtEp(sub.latestAiredEpisode.season, sub.latestAiredEpisode.episode) : '—' }}
                </StickerBadge>
              </div>
            </Card>
          </li>
        </TransitionGroup>
      </template>
    </template>
  </div>
</template>

<style scoped>
.shows-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.search-wrapper {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--cream);
  padding: var(--space-1) 0 var(--space-2);
}


.loading-hint {
  text-align: center;
  opacity: 0.6;
  font-size: var(--fs-sm);
  padding: var(--space-4) 0;
}

.fetch-error {
  margin: 0;
  padding: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--red);
  font-weight: var(--fw-medium);
  border: var(--border);
  border-radius: var(--radius);
  background: var(--paper);
}

/* Show list */
.show-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.show-item {
  cursor: pointer;
}

.show-card-btn {
  cursor: pointer;
}

.show-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.show-thumb {
  width: 44px;
  height: 66px;
  object-fit: cover;
  border-radius: 4px;
  border: var(--border);
  flex-shrink: 0;
}

.show-thumb-placeholder {
  width: 44px;
  height: 66px;
  border-radius: 4px;
  border: var(--border);
  background: var(--cream);
  flex-shrink: 0;
  opacity: 0.5;
}

.show-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.show-title {
  font-weight: var(--fw-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.show-title-orig {
  font-size: var(--fs-xs);
  opacity: 0.6;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscribed-badge,
.episode-badge {
  flex-shrink: 0;
}

/*
 * Show list TransitionGroup (FLIP-capable).
 * Matches DownloadsTab .task-list-* pattern per ADR-0006.
 */
.show-list-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
  transition-delay: calc(var(--stagger-index, 0) * var(--stagger-step));
}
.show-list-leave-active {
  transition:
    opacity var(--dur-list-leave) var(--ease-in),
    transform var(--dur-list-leave) var(--ease-in);
  position: absolute;
  width: 100%;
}
.show-list-move {
  transition: transform var(--dur-enter) var(--ease-out);
}
.show-list-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.show-list-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
