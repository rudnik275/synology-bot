import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// #11: the torrent-search results list was wrapped in a heavy bordered "card"
// box whose bottom border read as a leftover artifact. The list should be a
// clean scrolling list with row dividers only — no outer box border/shadow.
// happy-dom can't apply <style>, so assert the CSS source.
const src = readFileSync(
  fileURLToPath(new URL('../src/components/AddSearchStep.vue', import.meta.url)),
  'utf8',
)
const block = src.match(/\.search-results\s*\{[^}]*\}/)?.[0] ?? ''

describe('AddSearchStep — results list has no bordered-box chrome (#11)', () => {
  it('.search-results does not declare the full box border', () => {
    expect(block).not.toBe('')
    expect(block).not.toContain('border: var(--border)')
  })
  it('.search-results has no box-shadow chrome', () => {
    expect(block).not.toContain('box-shadow')
  })
})
