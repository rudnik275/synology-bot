import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// happy-dom does not apply <style>, so layout can't be measured in unit tests.
// We assert the CSS source declarations that make the search step's scroll chain
// work (#247/#12): the flex chain must bottom out so the inner results list owns
// the scroll, NOT the whole wizard body. The chain is:
//   .wizard-body (overflow-y:auto, min-height:0)
//     → .wizard-step (flex:1, min-height:0)   ← the missing link this guards
//       → .step-input/.search-field/.search-results (flex:1, min-height:0) [AddSearchStep]
const src = readFileSync(
  fileURLToPath(new URL('../src/components/AddFlow.vue', import.meta.url)),
  'utf8',
)

function ruleBlock(selector: string): string {
  const re = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`)
  return src.match(re)?.[0] ?? ''
}

describe('AddFlow — search step scroll chain (#247/#12)', () => {
  it('.wizard-step has min-height: 0 so the flex chain bottoms out at the results list', () => {
    const block = ruleBlock('.wizard-step')
    expect(block).not.toBe('')
    expect(block).toContain('min-height: 0')
  })

  it('.wizard-body stays the bounded scroll container (min-height:0 + overflow-y:auto)', () => {
    const block = ruleBlock('.wizard-body')
    expect(block).toContain('min-height: 0')
    expect(block).toContain('overflow-y: auto')
  })
})
