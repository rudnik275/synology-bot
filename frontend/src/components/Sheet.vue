<script setup lang="ts">
// Bottom sheet / modal. The Add flow (#63) and confirmations mount here.
// Slides up + pops in with the one spring easing we allow (cubic-bezier 0.34,1.4…);
// scrim fades. Dismiss via scrim tap, the close button, or Escape.
import { watch, onUnmounted } from 'vue'

const props = defineProps<{
  /** Open state — use with v-model:open. */
  open: boolean
  title?: string
}>()

const emit = defineEmits<{ 'update:open': [boolean]; close: [] }>()

function close(): void {
  emit('update:open', false)
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = isOpen ? 'hidden' : ''
    if (isOpen) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="scrim" @click.self="close">
        <div class="sheet" role="dialog" aria-modal="true" :aria-label="title">
          <header class="sheet-head">
            <h2 v-if="title" class="sheet-title">{{ title }}</h2>
            <button type="button" class="sheet-close" aria-label="Close" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div class="sheet-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(9, 9, 11, 0.5);
}
.sheet {
  width: 100%;
  max-width: 520px;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  background: var(--cream);
  border-top: var(--border-strong);
  border-left: var(--border-strong);
  border-right: var(--border-strong);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: var(--space-4);
  padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.sheet-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
}
.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  color: var(--ink);
  background: transparent;
  border: none;
  cursor: pointer;
}
.sheet-close svg {
  width: 24px;
  height: 24px;
}
.sheet-body {
  overflow-y: auto;
}

/* scrim fades; sheet slides up + springs (modal-from-source feel). */
.sheet-enter-active .sheet {
  transition: transform var(--dur-enter) var(--ease-pop);
}
.sheet-leave-active .sheet {
  transition: transform var(--dur-exit) var(--ease-in);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
