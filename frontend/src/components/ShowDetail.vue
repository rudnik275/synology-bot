<script setup lang="ts">
import type { ShowDetailView } from '../types'
import SeasonAccordion from './SeasonAccordion.vue'
import Button from './ui/Button.vue'
import EmptyState from './ui/EmptyState.vue'

defineProps<{
  show: ShowDetailView
  subscribing?: boolean
}>()

const emit = defineEmits<{
  subscribe: []
  unsubscribe: []
}>()
</script>

<template>
  <div class="show-detail">
    <!-- Poster + title block -->
    <div class="show-hero">
      <img
        v-if="show.poster"
        :src="show.poster"
        :alt="show.title"
        class="show-poster"
      />
      <div
        v-else
        class="show-poster-placeholder"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </div>
      <div class="show-titles">
        <h1 class="show-title">{{ show.title }}</h1>
        <p v-if="show.titleOriginal" class="show-title-original">{{ show.titleOriginal }}</p>
      </div>
    </div>

    <!-- Subscribe / Unsubscribe -->
    <div class="show-action">
      <Button
        v-if="show.isSubscribed"
        data-testid="unsubscribe-btn"
        variant="danger"
        size="lg"
        :disabled="subscribing"
        @click="emit('unsubscribe')"
      >
        {{ subscribing ? 'Отписка…' : 'Отписаться' }}
      </Button>
      <Button
        v-else
        data-testid="subscribe-btn"
        variant="primary"
        size="lg"
        :disabled="subscribing"
        @click="emit('subscribe')"
      >
        {{ subscribing ? 'Подписка…' : 'Подписаться' }}
      </Button>
    </div>

    <!-- Description -->
    <p v-if="show.description" class="show-description">{{ show.description }}</p>

    <!-- Seasons -->
    <section v-if="show.seasons.length > 0" class="seasons-section">
      <h2 class="section-title">Сезоны</h2>
      <SeasonAccordion :seasons="show.seasons" />
    </section>

    <EmptyState
      v-else
      title="Нет эпизодов"
      message="Эпизоды не найдены."
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="7" width="18" height="13" rx="1.5" />
          <path d="M8 3l4 4 4-4" />
        </svg>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.show-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.show-hero {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.show-poster {
  width: 96px;
  height: 144px;
  object-fit: cover;
  border-radius: var(--radius);
  border: var(--border);
  flex-shrink: 0;
}

.show-poster-placeholder {
  width: 96px;
  height: 144px;
  border-radius: var(--radius);
  border: var(--border);
  background: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.4;
}

.show-poster-placeholder svg {
  width: 40px;
  height: 40px;
}

.show-titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-1);
}

.show-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  line-height: 1.2;
}

.show-title-original {
  margin: 0;
  font-size: var(--fs-sm);
  opacity: 0.6;
  font-style: italic;
}

.show-action {
  display: flex;
}

.show-action .btn {
  flex: 1 1 auto;
}

.show-description {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  opacity: 0.85;
}

.section-title {
  margin: 0 0 var(--space-2) 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink);
}

.seasons-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
