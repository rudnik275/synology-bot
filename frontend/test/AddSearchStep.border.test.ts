import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// #11 dropped the results "card" box border (its bottom edge read as an
// artifact). #268 task 05 restores it: the user wants the black-bordered card
// back, and with the inner-scroll fix (#12) the border now frames the scrolling
// list rather than reading as a stray artifact.
// happy-dom can't apply <style>, so assert the CSS source.
const src = readFileSync(
  fileURLToPath(new URL('../src/components/AddSearchStep.vue', import.meta.url)),
  'utf8',
)
const block = src.match(/\.search-results\s*\{[^}]*\}/)?.[0] ?? ''

describe('AddSearchStep — results list is a bordered card (#268 task 05)', () => {
  it('.search-results declares the box border', () => {
    expect(block).not.toBe('')
    expect(block).toContain('border: var(--border)')
  })
  it('.search-results has the box-shadow chrome', () => {
    expect(block).toContain('box-shadow')
  })
})
