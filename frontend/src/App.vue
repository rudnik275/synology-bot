<script setup lang="ts">
// Neo-Brutalism app shell (ADR 0006): a swappable tab body and the 3-tab
// bottom bar. Default tab = Downloads.
// The Add-flow sheet overlay is mounted alongside DownloadsTab; the inline
// «Добавить загрузку» row (#118) in DownloadsTab calls addFlow.openSheet().
import { ref, useTemplateRef } from 'vue'
import TabBar from './components/ui/TabBar.vue'
import type { TabKey } from './components/ui/tabs'
import DownloadsTab from './tabs/DownloadsTab.vue'
import NasTab from './tabs/NasTab.vue'
import ShowsTab from './tabs/ShowsTab.vue'
import AddFlow from './components/AddFlow.vue'
import { startParam } from './telegram'
import { resolveStartTab } from './startTab'

const activeTab = ref<TabKey>(resolveStartTab(startParam))

const TAB_VIEWS = {
  downloads: DownloadsTab,
  nas: NasTab,
  shows: ShowsTab,
} as const

const addFlowRef = useTemplateRef<InstanceType<typeof AddFlow>>('addFlow')

function openAddWizard(): void {
  addFlowRef.value?.openSheet()
}
</script>

<template>
  <div class="shell">
    <main class="content">
      <Transition name="tab" mode="out-in">
        <!-- Pass openAddWizard as prop only to DownloadsTab; other tabs ignore it -->
        <DownloadsTab v-if="activeTab === 'downloads'" :key="activeTab" :on-add-click="openAddWizard" />
        <component :is="TAB_VIEWS[activeTab]" v-else :key="activeTab" />
      </Transition>
    </main>

    <AddFlow v-if="activeTab === 'downloads'" ref="addFlow" />
    <TabBar v-model="activeTab" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}

.content {
  /* Top: safe-area inset only (no extra chip-row clearance needed). */
  padding-top: env(safe-area-inset-top, 0px);
  /* Reserve clearance for the FLOATING pill nav: it sits off the bottom edge
   * (safe-bottom + space-3) and is ~62px tall. Extra space-4 so the last row's
   * offset shadow doesn't crowd / stick to the nav. */
  padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--space-4) + var(--space-4));
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
