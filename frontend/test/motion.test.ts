// Motion polish tests (#72): reduced-motion contract + usePrefersReducedMotion composable.
//
// Two concerns:
// 1. tokens.css contains the @media (prefers-reduced-motion: reduce) block that zeroes
//    CSS transition/animation durations — this is the hard ADR 0006 requirement.
// 2. The usePrefersReducedMotion composable correctly reads matchMedia on both branches.
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { usePrefersReducedMotion } from '../src/composables/usePrefersReducedMotion'

// ---------------------------------------------------------------------------
// 1. Static assertion: tokens.css contains the reduced-motion disable block.
// ---------------------------------------------------------------------------
describe('tokens.css — reduced-motion contract', () => {
  const tokensPath = resolve(__dirname, '../src/styles/tokens.css')
  const css = readFileSync(tokensPath, 'utf-8')

  it('contains a @media (prefers-reduced-motion: reduce) block', () => {
    expect(css).toContain('prefers-reduced-motion: reduce')
  })

  it('zeroes transition-duration inside that block', () => {
    // Find the block and confirm it zeroes transition-duration.
    expect(css).toContain('transition-duration: 0.01ms')
  })

  it('zeroes animation-duration inside that block', () => {
    expect(css).toContain('animation-duration: 0.01ms')
  })
})

// ---------------------------------------------------------------------------
// 2. usePrefersReducedMotion: both branches (motion allowed + reduced).
// ---------------------------------------------------------------------------

type MatchMediaListener = (e: MediaQueryListEvent | MediaQueryList) => void

function makeMockMql(matches: boolean): MediaQueryList {
  const listeners: MatchMediaListener[] = []
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener(_type: string, cb: MatchMediaListener) {
      listeners.push(cb)
    },
    removeEventListener(_type: string, cb: MatchMediaListener) {
      const idx = listeners.indexOf(cb)
      if (idx !== -1) listeners.splice(idx, 1)
    },
    dispatchEvent: () => false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  } as unknown as MediaQueryList
}

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const app = mount(
    defineComponent({
      setup() {
        result = composable()
        return () => null
      },
    }),
  )
  return { result, unmount: () => app.unmount() }
}

describe('usePrefersReducedMotion', () => {
  const originalMatchMedia = globalThis.window?.matchMedia

  afterEach(() => {
    if (typeof window !== 'undefined') {
      if (originalMatchMedia) {
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          configurable: true,
          value: originalMatchMedia,
        })
      }
    }
  })

  it('returns false when prefers-reduced-motion is NOT set', async () => {
    const mql = makeMockMql(false)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (_query: string) => mql,
    })

    const { result, unmount } = withSetup(() => usePrefersReducedMotion())
    await flushPromises()

    expect(result.prefersReducedMotion.value).toBe(false)
    unmount()
  })

  it('returns true when prefers-reduced-motion: reduce IS set', async () => {
    const mql = makeMockMql(true)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (_query: string) => mql,
    })

    const { result, unmount } = withSetup(() => usePrefersReducedMotion())
    await flushPromises()

    expect(result.prefersReducedMotion.value).toBe(true)
    unmount()
  })

  it('defaults to false when matchMedia is unavailable (SSR/test env)', async () => {
    // Simulate environment without matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    })

    const { result, unmount } = withSetup(() => usePrefersReducedMotion())
    await flushPromises()

    expect(result.prefersReducedMotion.value).toBe(false)
    unmount()
  })
})
