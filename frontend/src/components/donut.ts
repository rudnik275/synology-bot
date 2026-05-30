// Donut segment shape — kept in a .ts module (not exported from Donut.vue) so
// consumers can import the type without resolving a `.vue` named export, which
// vue-tsc rejects on clean/Linux builds (TS2614 against the default-only *.vue
// shim). Same pattern as health.ts / tones.ts.
export interface DonutSegment {
  label: string
  /** Raw magnitude — proportions are derived from the sum across segments. */
  value: number
  /** Pre-formatted value shown in the legend (e.g. "3.2 GB"). */
  display: string
  /** Render the legend row de-emphasised (e.g. "free" / "idle"). */
  muted?: boolean
}
