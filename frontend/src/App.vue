<script setup lang="ts">
// Hub-and-spoke app shell (ADR 0015, S1 #222). A Home hub is the ROOT; the old
// bottom tab bar is gone. From the hub the user opens one of three full-screen
// spoke sections (Downloads / NAS / Shows); the native Telegram BackButton pops
// the section back to the hub.
//
// ── Native Back coordination (the load-bearing part) ──────────────────────────
// The native BackButton fires EVERY registered onClick handler on a press, so we
// must guarantee exactly ONE active handler at a time. Two surfaces already own
// the BackButton from inside a section: the Add wizard (while its sheet is open)
// and ShowsTab (while its detail sub-view is open). Each reports ownership to the
// shell via an `owns-back` event. The shell registers its OWN section→hub
// handler only when (a) we're in a section (not the hub root) AND (b) no child
// currently owns back. So one press always pops exactly one level: wizard step /
// show detail → section → hub, never two at once.
//
// The Add wizard is mounted at the SHELL level (not gated behind the Downloads
// section) so it is reachable from the hub and any section, and the `tor-<token>`
// deep-link auto-open still fires on boot (AddFlow self-opens onMounted).
// The global FAB was removed in #249 — Downloads uses an inline add-row instead
// (restored from d635453). After a successful add, AddFlow emits 'added' and the
// shell navigates to the Downloads section so the user lands on the right screen.
import { ref, computed, watch, useTemplateRef } from 'vue'
import HomeHub from './components/HomeHub.vue'
import DownloadsTab from './tabs/DownloadsTab.vue'
import NasTab from './tabs/NasTab.vue'
import ShowsTab from './tabs/ShowsTab.vue'
import AddFlow from './components/AddFlow.vue'
import { startParam } from './telegram'
import { resolveStartView } from './startTab'
import type { SectionKey } from './sections'
import { useTgBackButton } from './composables/useTgBackButton'

// Root view: the hub, or a pushed full-screen section. Deep-links retarget here
// (downloads/nas/shows → that section directly; anything else → hub).
const view = ref(resolveStartView(startParam))

const SECTION_VIEWS = {
  downloads: DownloadsTab,
  nas: NasTab,
  shows: ShowsTab,
} as const

const isHub = computed(() => view.value === 'hub')

// A child surface (Add wizard sheet / Shows detail) owns the native BackButton.
// While owned, the shell does NOT bind its section→hub handler (single-handler
// invariant — see the file header).
const childOwnsBack = ref(false)
function onChildOwnsBack(owns: boolean): void {
  childOwnsBack.value = owns
}

const addFlowRef = useTemplateRef<InstanceType<typeof AddFlow>>('addFlow')

function openAddWizard(): void {
  addFlowRef.value?.openSheet()
}

function navigateTo(section: SectionKey): void {
  view.value = section
}

function goToHub(): void {
  view.value = 'hub'
}

// The shell's section→hub Back handler. Active only in a section AND when no
// child surface owns the native button.
const shellBackActive = computed(() => !isHub.value && !childOwnsBack.value)
const { show: showShellBack, hide: hideShellBack } = useTgBackButton(goToHub)
watch(shellBackActive, (active) => {
  if (active) showShellBack()
  else hideShellBack()
}, { immediate: true })
</script>

<template>
  <div class="shell">
    <main class="content">
      <Transition name="view" mode="out-in">
        <!-- Hub root: plain section rows; tapping one pushes that section. -->
        <HomeHub v-if="isHub" key="hub" @navigate="navigateTo" />

        <!-- Downloads section: inline add-row is the Add affordance (#249). -->
        <DownloadsTab v-else-if="view === 'downloads'" key="downloads" :on-add-click="openAddWizard" />

        <!-- Shows reports detail-open via owns-back so the shell yields native Back. -->
        <ShowsTab v-else-if="view === 'shows'" key="shows" @owns-back="onChildOwnsBack" />

        <component :is="SECTION_VIEWS[view as SectionKey]" v-else :key="view" />
      </Transition>
    </main>

    <!-- Mounted at the shell so the wizard is reachable from any section/hub, and
         the tor-<token> auto-open fires on boot regardless of view. While open it
         owns native Back; 'added' navigates to Downloads so the user lands there. -->
    <AddFlow ref="addFlow" @owns-back="onChildOwnsBack" @added="navigateTo('downloads')" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}

.content {
  /* Top: safe-area inset only. */
  padding-top: env(safe-area-inset-top, 0px);
  /* No bottom tab bar anymore (ADR 0015) — just clear the device safe-area plus
   * breathing room so the last card's offset shadow isn't crowded. */
  padding-bottom: calc(var(--safe-bottom) + var(--space-4));
  min-height: 100dvh;
}

/* Crossfade between hub and section — content replacement in the same container. */
.view-enter-active,
.view-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}
.view-enter-from,
.view-leave-to {
  opacity: 0;
}
</style>
