<script setup lang="ts">
import { ref } from 'vue'
import ActiveTab from './tabs/ActiveTab.vue'
import SearchTab from './tabs/SearchTab.vue'
import NasTab from './tabs/NasTab.vue'
import ShowsTab from './tabs/ShowsTab.vue'

type TabId = 'active' | 'search' | 'nas' | 'shows'

const tabs: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'active', label: 'Active', icon: '⬇️' },
  { id: 'search', label: 'Search', icon: '🔍' },
  { id: 'nas', label: 'NAS', icon: '🖥️' },
  { id: 'shows', label: 'Shows', icon: '📺' },
]

const active = ref<TabId>('nas')
</script>

<template>
  <main class="content">
    <ActiveTab v-show="active === 'active'" />
    <SearchTab v-show="active === 'search'" />
    <NasTab v-show="active === 'nas'" />
    <ShowsTab v-show="active === 'shows'" />
  </main>

  <nav class="tabbar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ active: active === tab.id }"
      @click="active = tab.id"
    >
      <span class="icon">{{ tab.icon }}</span>
      {{ tab.label }}
    </button>
  </nav>
</template>
