// TDD tests for:
//   #1  NasTab .section-head asymmetric margin (40px top / 8px bottom)
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

describe('NasTab .section-head margin rhythm (#1)', () => {
  it('has a 40px top margin on .section-head in the component source', () => {
    const vueFile = path.resolve(
      import.meta.dir,
      '../src/tabs/NasTab.vue',
    )
    const source = fs.readFileSync(vueFile, 'utf-8')

    // Extract the <style> block content
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    expect(styleMatch).not.toBeNull()
    const css = styleMatch![1]

    // The .section-head rule must use a large top margin (40px) so the label
    // visually groups with the block below it, not the block above.
    expect(css).toMatch(/\.section-head\s*\{[^}]*margin:\s*40px\s+0\s+var\(--space-2\)/)
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
