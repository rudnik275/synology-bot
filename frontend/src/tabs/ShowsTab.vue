<script setup lang="ts">
// Shows tab — subscriptions CRUD + today-airing block (#64).
// Composes useSubscriptions (which wraps useApi) and the shared component kit.
// Does NOT build name-search — add UI takes a numeric showId only.
import { ref } from 'vue'
import { useSubscriptions } from '../composables/useSubscriptions'
import Card from '../components/Card.vue'
import StickerBadge from '../components/StickerBadge.vue'
import EmptyState from '../components/EmptyState.vue'

const { subscriptions, todayEpisodes, loading, error, add, remove } = useSubscriptions()

const showIdInput = ref('')
const addError = ref<string | null>(null)

/** Zero-padded SxxEyy string */
function fmtEp(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

async function handleAdd() {
  addError.value = null
  const id = Number(showIdInput.value)
  if (!Number.isInteger(id) || id <= 0) {
    addError.value = 'Enter a valid numeric show ID'
    return
  }
  try {
    await add(id)
    showIdInput.value = ''
  } catch (e) {
    addError.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleRemove(id: string) {
  try {
    await remove(id)
  } catch {
    // swallow — refetch will keep list consistent
  }
}
</script>

<template>
  <div class="shows-tab">
    <!-- Today-airing block: only shown when there are episodes -->
    <section v-if="todayEpisodes.length > 0" class="today-section">
      <h2 class="section-title">Today</h2>
      <Card tone="yellow">
        <ul class="episode-list">
          <li v-for="ep in todayEpisodes" :key="`${ep.showId}-${ep.season}-${ep.episode}`" class="episode-row">
            <span class="ep-title">{{ ep.title }}</span>
            <span class="ep-meta">{{ fmtEp(ep.season, ep.episode) }}</span>
            <span class="ep-time">{{ ep.airTime }}</span>
          </li>
        </ul>
      </Card>
    </section>

    <!-- Add form -->
    <section class="add-section">
      <h2 class="section-title">Add show</h2>
      <Card>
        <div class="add-form">
          <input
            v-model="showIdInput"
            type="number"
            placeholder="Show ID (numeric)"
            class="id-input"
            min="1"
            @keydown.enter="handleAdd"
          />
          <button data-testid="add-btn" class="add-btn" :disabled="loading" @click="handleAdd">Add</button>
        </div>
        <p v-if="addError" class="add-error">{{ addError }}</p>
      </Card>
    </section>

    <!-- Fetch error banner -->
    <p v-if="error" class="fetch-error">{{ error }}</p>

    <!-- Empty state -->
    <EmptyState
      v-if="!loading && subscriptions.length === 0"
      title="No shows"
      message="Subscribe to a show by its numeric ID to track new episodes."
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </template>
    </EmptyState>

    <!-- Subscriptions list -->
    <section v-if="subscriptions.length > 0" class="subs-section">
      <h2 class="section-title">Subscriptions</h2>
      <TransitionGroup tag="ul" name="sub-list" class="subs-list">
        <li v-for="(sub, index) in subscriptions" :key="sub.id" class="sub-item" :style="{ '--stagger-index': index }">
          <Card>
            <div class="sub-row">
              <span class="sub-title">{{ sub.title }}</span>
              <StickerBadge :tone="sub.lastNotifiedEpisode ? 'green' : 'orange'">
                {{ sub.lastNotifiedEpisode ? fmtEp(sub.lastNotifiedEpisode.season, sub.lastNotifiedEpisode.episode) : 'NEW' }}
              </StickerBadge>
              <button
                data-testid="remove-btn"
                class="remove-btn"
                :aria-label="`Remove ${sub.title}`"
                @click="handleRemove(sub.id)"
              >
                Remove
              </button>
            </div>
          </Card>
        </li>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.shows-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.section-title {
  margin: 0 0 var(--space-2) 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink);
}

/* Today block */
.episode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.episode-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.ep-title {
  font-weight: var(--fw-medium);
  flex: 1 1 auto;
}

.ep-meta {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
}

.ep-time {
  font-size: var(--fs-xs);
  color: var(--ink);
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

/* Add form */
.add-form {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.id-input {
  flex: 1 1 auto;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--ink);
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
  outline: none;
  min-width: 0;
}

.id-input:focus {
  box-shadow: var(--shadow-sm);
}

.add-btn {
  padding: var(--space-2) var(--space-4);
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  background: var(--yellow);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  min-height: 44px;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}

.add-btn:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.add-error {
  margin: var(--space-2) 0 0 0;
  font-size: var(--fs-sm);
  color: var(--red);
  font-weight: var(--fw-medium);
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

/* Subscriptions list */
.subs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  position: relative; /* needed for leaving items pulled to absolute */
}

/*
 * Subscriptions TransitionGroup (FLIP-capable).
 * Same recipe as the Downloads task list for visual consistency.
 */
.sub-list-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
  transition-delay: calc(var(--stagger-index, 0) * var(--stagger-step));
}
.sub-list-leave-active {
  transition:
    opacity var(--dur-list-leave) var(--ease-in),
    transform var(--dur-list-leave) var(--ease-in);
  position: absolute;
  width: 100%;
}
.sub-list-move {
  transition: transform var(--dur-enter) var(--ease-out);
}
.sub-list-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.sub-list-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.sub-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.sub-title {
  font-weight: var(--fw-medium);
  flex: 1 1 auto;
}

.remove-btn {
  padding: var(--space-2) var(--space-3);
  font-family: var(--font);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--paper);
  background: var(--red);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  min-height: 44px;
  transition:
    transform var(--dur-press) var(--ease-mechanical),
    box-shadow var(--dur-press) var(--ease-mechanical);
}

.remove-btn:active {
  transform: translate(3px, 3px);
  box-shadow: var(--shadow-none);
}
</style>
