// The three spoke SECTIONS of the hub-and-spoke IA (ADR 0015). Replaces the
// old jobs-first tab model (TabKey / tabs.ts): the bottom tab bar is gone and a
// Home hub is the root, routing into one of these full-screen sections.
//
// Lives in a .ts module (not exported from a .vue component) so non-component
// consumers — startTab.ts, the App shell — can import the type without resolving
// a `.vue` named export, which vue-tsc only reliably resolves on
// case-insensitive filesystems (the `*.vue` shim in env.d.ts).
export type SectionKey = 'downloads' | 'nas' | 'shows'

/** The sections in hub-row display order. */
export const SECTIONS: readonly SectionKey[] = ['downloads', 'nas', 'shows']
