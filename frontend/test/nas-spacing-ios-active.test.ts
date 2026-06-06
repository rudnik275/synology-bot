// TDD tests for:
//   #1  NasTab .section-head asymmetric margin — label hugs its own card below,
//       separated from the block above (rebalanced in #270 task 11)
//   #14 iOS :active enabler — touchstart listener added to body
//
// Written RED first (before implementation), then made GREEN.

import { describe, it, expect, afterEach } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

// ─── Fix #1: NasTab section-head rhythm ─────────────────────────────────────
// happy-dom drops <style scoped> at compile time, so we cannot query computed
// CSS in a mounted component. The pragmatic approach: assert the CSS rule text
// inside the .vue SFC source. This directly pins the shipped rule to the
// intended visual contract ("margin: 40px 0 var(--space-2)").

describe('NasTab .section-head margin rhythm (#1, rebalanced #270 task 11)', () => {
  it('has top-only margin on .section-head so the label hugs its card below', () => {
    const vueFile = path.resolve(
      import.meta.dir,
      '../src/tabs/NasTab.vue',
    )
    const source = fs.readFileSync(vueFile, 'utf-8')

    // Extract the <style> block content
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    expect(styleMatch).not.toBeNull()
    const css = styleMatch![1]

    // #270 task 11: the label hugs its OWN card below (no bottom margin — the
    // tight base gap separates them by ~4px) and sits ~16px below the previous
    // section's card (this 12px top margin + the 4px base gap). The earlier
    // 40px-top / 8px-bottom rhythm read as too loose for the user.
    expect(css).toMatch(/\.section-head\s*\{[^}]*margin:\s*var\(--space-3\)\s+0\s+0/)
  })

  it('uses a 4px base gap on .nas-tab so labels hug their cards', () => {
    const vueFile = path.resolve(import.meta.dir, '../src/tabs/NasTab.vue')
    const css = fs.readFileSync(vueFile, 'utf-8').match(/<style[^>]*>([\s\S]*?)<\/style>/)![1]
    expect(css).toMatch(/\.nas-tab\s*\{[^}]*gap:\s*var\(--space-1\)/)
  })
})

// ─── Fix #14: iOS :active touchstart enabler ────────────────────────────────
// The enabler is a tiny exported function. We test it directly so the test
// doesn't depend on bootstrapping the full Vue app.

describe('enableIosActive (#14)', () => {
  const originalAddEventListener = document.body.addEventListener.bind(document.body)

  afterEach(() => {
    // No real cleanup needed — we just verify the listener was registered.
  })

  it('adds a passive touchstart listener to document.body', async () => {
    const { enableIosActive } = await import('../src/enableIosActive')

    const calls: { type: string; options: unknown }[] = []
    const original = document.body.addEventListener
    document.body.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      calls.push({ type, options })
      return original.call(this, type, listener, options)
    } as typeof document.body.addEventListener

    enableIosActive()

    document.body.addEventListener = original

    const found = calls.find((c) => c.type === 'touchstart')
    expect(found).not.toBeUndefined()
    expect((found!.options as AddEventListenerOptions).passive).toBe(true)
  })

  it('is safe to call when document is undefined (SSR / non-browser env)', async () => {
    const { enableIosActive } = await import('../src/enableIosActive')

    // Should not throw even if invoked in an env without document
    const savedDocument = globalThis.document
    // @ts-ignore — intentional test of SSR guard
    globalThis.document = undefined
    expect(() => enableIosActive()).not.toThrow()
    globalThis.document = savedDocument
  })
})
