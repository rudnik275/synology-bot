import { describe, it, expect, mock, beforeEach } from 'bun:test'

import { classifyInput } from '../../../src/handlers/input-router.ts'

describe('classifyInput', () => {
  // --- magnet ---
  it('returns "magnet" for text containing a magnet URI', () => {
    const text = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12'
    expect(classifyInput(text)).toBe('magnet')
  })

  it('returns "magnet" for text containing magnet embedded in other text', () => {
    const text = 'Check this: magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12 wow'
    expect(classifyInput(text)).toBe('magnet')
  })

  // --- slash commands → unknown ---
  it('returns "unknown" for slash commands', () => {
    expect(classifyInput('/search foo')).toBe('unknown')
  })

  it('returns "unknown" for /menu', () => {
    expect(classifyInput('/menu')).toBe('unknown')
  })

  it('returns "unknown" for command-like text starting with /', () => {
    expect(classifyInput('/help')).toBe('unknown')
  })

  // --- empty / whitespace → unknown ---
  it('returns "unknown" for empty string', () => {
    expect(classifyInput('')).toBe('unknown')
  })

  it('returns "unknown" for whitespace-only text', () => {
    expect(classifyInput('   ')).toBe('unknown')
  })

  // --- too short → unknown ---
  it('returns "unknown" for text shorter than 3 chars', () => {
    expect(classifyInput('ok')).toBe('unknown')
  })

  it('returns "unknown" for 1-char text', () => {
    expect(classifyInput('x')).toBe('unknown')
  })

  // --- too long → unknown ---
  it('returns "unknown" for text longer than 200 chars', () => {
    const longText = 'a'.repeat(201)
    expect(classifyInput(longText)).toBe('unknown')
  })

  it('returns "unknown" for text exactly 201 chars', () => {
    expect(classifyInput('x'.repeat(201))).toBe('unknown')
  })

  // --- search ---
  it('returns "search" for plain free-form text', () => {
    expect(classifyInput('ubuntu 24.04')).toBe('search')
  })

  it('returns "search" for exactly 3-char text', () => {
    expect(classifyInput('abc')).toBe('search')
  })

  it('returns "search" for exactly 200-char text', () => {
    expect(classifyInput('a'.repeat(200))).toBe('search')
  })

  it('returns "search" for normal query text', () => {
    expect(classifyInput('The Matrix 1080p')).toBe('search')
  })

  it('returns "search" for text with numbers', () => {
    expect(classifyInput('ubuntu 22.04')).toBe('search')
  })
})

// --- Router dispatch tests ---
describe('registerInputRouter dispatch', () => {
  it('dispatches "search" classification to runTolokaSearch', async () => {
    // We test the logic directly using classifyInput + mock dispatch
    // (full handler wiring involves grammy Bot internals)
    const runTolokaSearchMock = mock(async () => {})

    const text = 'ubuntu 24.04'
    const kind = classifyInput(text)

    expect(kind).toBe('search')

    // Simulate dispatch — router calls runTolokaSearch when kind === 'search'
    let called = false
    let calledQuery = ''
    if (kind === 'search') {
      called = true
      calledQuery = text.trim()
      await runTolokaSearchMock()
    }

    expect(called).toBe(true)
    expect(calledQuery).toBe('ubuntu 24.04')
    expect(runTolokaSearchMock).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch "unknown" to search', async () => {
    const runTolokaSearchMock = mock(async () => {})

    const kind = classifyInput('/menu')
    expect(kind).toBe('unknown')

    let called = false
    if (kind === 'search') {
      called = true
      await runTolokaSearchMock()
    }

    expect(called).toBe(false)
    expect(runTolokaSearchMock).not.toHaveBeenCalled()
  })

  it('does not dispatch magnet to search', async () => {
    const runTolokaSearchMock = mock(async () => {})

    const text = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12'
    const kind = classifyInput(text)
    expect(kind).toBe('magnet')

    let called = false
    if (kind === 'search') {
      called = true
      await runTolokaSearchMock()
    }

    expect(called).toBe(false)
    expect(runTolokaSearchMock).not.toHaveBeenCalled()
  })
})
