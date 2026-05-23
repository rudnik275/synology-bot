import { describe, it, expect, mock, beforeEach } from 'bun:test'

// We test classifyInput which is the pure classification logic in InputRouter
import { classifyInput } from '../../../src/handlers/input-router.ts'

describe('classifyInput', () => {
  it('returns "magnet" for text containing a magnet URI', () => {
    const text = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12'
    expect(classifyInput(text)).toBe('magnet')
  })

  it('returns "magnet" for text containing magnet embedded in other text', () => {
    const text = 'Check this: magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12 wow'
    expect(classifyInput(text)).toBe('magnet')
  })

  it('returns "unknown" for plain text without magnet', () => {
    expect(classifyInput('Hello world')).toBe('unknown')
  })

  it('returns "unknown" for empty string', () => {
    expect(classifyInput('')).toBe('unknown')
  })

  it('returns "unknown" for command-like text', () => {
    expect(classifyInput('/help')).toBe('unknown')
  })
})
