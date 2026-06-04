// Shared Telegram BackButton wiring (#177), extracted from the duplicated
// show/hide/onClick/offClick blocks in AddFlow.vue and ShowsTab.vue.
//
// The native Telegram BackButton is how both the add-flow wizard (between steps,
// ADR 0009) and the Shows detail page expose "Назад". This composable binds ONE
// handler to that button and offers imperative show()/hide() so call sites never
// sprinkle SDK calls (or forget the offClick on the way out). It is a pure no-op
// outside Telegram (bare browser / unit tests), where BackButton is undefined.
import { getCurrentInstance, onUnmounted } from 'vue'

export interface UseTgBackButton {
  /** Show the native back button and (idempotently) register the handler. */
  show: () => void
  /** Hide the native back button and unregister the handler. */
  hide: () => void
}

export function useTgBackButton(handler: () => void): UseTgBackButton {
  function show(): void {
    const btn = window.Telegram?.WebApp?.BackButton
    if (!btn) return
    btn.show()
    btn.onClick(handler)
  }

  function hide(): void {
    const btn = window.Telegram?.WebApp?.BackButton
    if (!btn) return
    btn.hide()
    btn.offClick(handler)
  }

  // Belt-and-braces cleanup: never leave the native button shown (and the handler
  // bound) after the owning component unmounts. Guarded so the composable is still
  // callable outside a setup() in unit tests without emitting a Vue warning.
  if (getCurrentInstance()) onUnmounted(hide)

  return { show, hide }
}
