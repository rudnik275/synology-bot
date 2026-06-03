// Preloaded by `bun test` (see ../bunfig.toml) before any test module loads.
// Two jobs, both required for component tests:
//   1. Register happy-dom as the global DOM so @vue/test-utils `mount()` works.
//   2. Teach Bun how to import `.vue` SFCs (Bun has no native loader for them).
//
// Both backend and frontend tests run under a single `bun test`; the DOM
// globals are inert for backend tests and the .vue loader only fires on
// `.vue` imports, so this preload is harmless to the server suite.
import { plugin } from 'bun'
import { afterEach } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { parse, compileScript } from '@vue/compiler-sfc'

// happy-dom registers its own fetch/Request/Response/Headers/FormData/File/Blob
// onto globalThis, which are NOT byte-compatible with Bun's native web APIs and
// break the backend suite (Hono multipart parsing, Toloka Set-Cookie capture).
// Component tests need only the DOM (document/window/Element), so we snapshot
// Bun's native networking globals and restore them after registration.
const NATIVE_NET_GLOBALS = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'File',
  'Blob',
] as const
const native = Object.fromEntries(
  NATIVE_NET_GLOBALS.map((k) => [k, (globalThis as Record<string, unknown>)[k]])
)

GlobalRegistrator.register()

for (const k of NATIVE_NET_GLOBALS) {
  ;(globalThis as Record<string, unknown>)[k] = native[k]
}

let idSeq = 0

plugin({
  name: 'vue-sfc',
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const source = await Bun.file(path).text()
      const { descriptor } = parse(source, { filename: path })

      const id = `data-v-${(idSeq++).toString(36)}`
      const isTs = descriptor.script?.lang === 'ts' || descriptor.scriptSetup?.lang === 'ts'
      const hasScopedStyle = descriptor.styles.some((s) => s.scoped)

      // inlineTemplate merges the template's render fn straight into the
      // setup-returned component and resolves identifiers against the
      // <script setup> binding metadata — no manual render/bindings merge.
      // <style> blocks are intentionally dropped: unit tests don't need CSS.
      const compiled = compileScript(descriptor, {
        id,
        inlineTemplate: true,
        templateOptions: {
          compilerOptions: {
            scopeId: hasScopedStyle ? id : undefined,
          },
        },
      })

      return { contents: compiled.content, loader: isTs ? 'ts' : 'js' }
    })
  },
})

// Guarantee DOM + storage isolation between tests, regardless of file order.
// `bun test` discovers files in a filesystem-dependent order that differs
// between macOS (local) and Linux (CI). A test that mounts a component which
// teleports into <body> (e.g. the AddFlow dialog) or writes localStorage can
// otherwise leak into a later test that assumes a clean slate — which is why CI
// (Linux order) went red while local (macOS order) stayed green. A global
// afterEach makes the suite order-independent. Inert for the backend suite
// (it neither touches document.body nor localStorage).
afterEach(async () => {
  document.body.innerHTML = ''
  localStorage.clear()
  // The optimistic-task store is a module singleton shared across the whole test
  // process — clear it so placeholders / the seen-id baseline don't leak forward.
  // Imported lazily (not at preload top): a static import would pull vue's
  // runtime-dom in BEFORE GlobalRegistrator.register() sets up `document`, so
  // vue would capture a null document and every component mount would fail with
  // `doc.createTextNode`. By afterEach time the DOM is registered.
  const { resetOptimisticTasks } = await import('./src/composables/useOptimisticTasks')
  resetOptimisticTasks()
})
