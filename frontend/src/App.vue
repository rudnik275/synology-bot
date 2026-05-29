<script setup lang="ts">
// Neo-Brutalism app shell (ADR 0006): fixed header with title + ambient health
// chip, a swappable tab body, and the 3-tab bottom bar. Default tab = Downloads.
// No tab data here — the three tab bodies are stubs filled by #61/#70/#64; the
// Add-flow FAB+sheet overlay is mounted separately by #63.
import { ref } from 'vue'
import TabBar, { type TabKey } from './components/TabBar.vue'
import HealthChip from './components/HealthChip.vue'
import DownloadsTab from './tabs/DownloadsTab.vue'
import NasTab from './tabs/NasTab.vue'
import ShowsTab from './tabs/ShowsTab.vue'
import { useHealth } from './composables/useHealth'

const activeTab = ref<TabKey>('downloads')
const { chipStatus, chipMetric } = useHealth()

const TAB_VIEWS = {
  downloads: DownloadsTab,
  nas: NasTab,
  shows: ShowsTab,
} as const
</script>

<template>
  <div class="shell">
    <header class="header">
      <span class="brand">NAS</span>
      <HealthChip :status="chipStatus" :metric="chipMetric" @click="activeTab = 'nas'" />
    </header>

    <main class="content">
      <Transition name="tab" mode="out-in">
        <component :is="TAB_VIEWS[activeTab]" :key="activeTab" />
      </Transition>
    </main>

    <TabBar v-model="activeTab" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-tabbar);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) var(--space-4) 0;
  background: var(--cream);
  border-bottom: var(--border-strong);
}
.brand {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  letter-spacing: 0.06em;
}
.content {
  padding-top: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  min-height: 100dvh;
}

/* Crossfade between tabs — content replacement in the same container. */
.tab-enter-active,
.tab-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}
.tab-enter-from,
.tab-leave-to {
  opacity: 0;
}
</style>
