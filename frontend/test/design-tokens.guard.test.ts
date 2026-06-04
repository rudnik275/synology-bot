// Guard test: no raw ink-alpha or pill-radius literals in components/.
//
// Purpose: ensure the token sweep (Theme 1 sub-issue b, #176) can't silently regress.
// Every rgba(9, 9, 11, …) and every 999px in frontend/src/components/** must be
// replaced with a CSS custom-property reference; the actual values live in tokens.css.
//
// tokens.css is intentionally EXEMPT — it IS the source of truth.
// frontend/src/tabs/ is covered by a separate sweep (not guarded here yet).

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const result: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      result.push(...collectFiles(full))
    } else {
      result.push(full)
    }
  }
  return result
}

const COMPONENTS_DIR = join(import.meta.dir, '../src/components')

const files = collectFiles(COMPONENTS_DIR)

describe('design-tokens guard', () => {
  it('has no raw rgba(9, 9, 11, …) ink-alpha literals in components/', () => {
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        if (/rgba\(\s*9\s*,\s*9\s*,\s*11\s*,/.test(line)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('has no raw 999px border-radius pill literals in components/', () => {
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        if (/\b999px\b/.test(line)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
