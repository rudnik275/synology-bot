/**
 * iOS Safari fires :active on non-native elements only if a touchstart listener
 * is present on an ancestor. Adding an empty passive listener to document.body
 * unlocks the :active pseudo-class for .nb-pressable (and any other pressable
 * elements) across the whole app.
 *
 * Safe to call in SSR contexts — guarded by typeof document check.
 */
export function enableIosActive(): void {
  if (typeof document !== 'undefined') {
    document.body.addEventListener('touchstart', () => {}, { passive: true })
  }
}
