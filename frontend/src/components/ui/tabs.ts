// The three bottom-bar tabs (ADR 0006 jobs-first IA). Lives in a .ts module
// (not exported from TabBar.vue) so non-component consumers — startTab.ts, the
// shell — can import the type without resolving a `.vue` named export, which
// vue-tsc only resolves on case-insensitive filesystems (see the `*.vue` shim
// in env.d.ts; on Linux/clean builds it falls back to the default-only shim).
export type TabKey = 'downloads' | 'nas' | 'shows'
