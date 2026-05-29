/**
 * usePrefersReducedMotion — reads window.matchMedia('(prefers-reduced-motion: reduce)').
 *
 * Returns a reactive boolean that is true when the user has requested reduced motion.
 * Components use this to skip JS-driven animations that cannot be disabled by the CSS
 * token rule alone (the global tokens.css rule already zeroes transition/animation
 * durations for CSS-only motion, so this composable is for JS-controlled motion only).
 *
 * Works in SSR / test environments: when matchMedia is absent (happy-dom in tests doesn't
 * always expose it), defaults to false (motion allowed) so tests don't break.
 */
import { ref, onMounted, onUnmounted } from 'vue'

export function usePrefersReducedMotion(): { prefersReducedMotion: ReturnType<typeof ref<boolean>> } {
  const prefersReducedMotion = ref(false)

  let mql: MediaQueryList | null = null

  function update(e: MediaQueryListEvent | MediaQueryList): void {
    prefersReducedMotion.value = e.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.value = mql.matches
    mql.addEventListener('change', update)
  })

  onUnmounted(() => {
    mql?.removeEventListener('change', update)
  })

  return { prefersReducedMotion }
}
