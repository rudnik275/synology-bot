// Deep-link → initial view resolution for the hub-and-spoke shell (ADR 0015).
// A bare/unknown start param now lands on the HUB (not Downloads); a section
// token boots directly into that section, bypassing the hub.
import { describe, it, expect } from 'bun:test'
import { resolveStartView } from '../src/startTab'

describe('resolveStartView', () => {
  it('maps "downloads" to the downloads section', () => {
    expect(resolveStartView('downloads')).toBe('downloads')
  })
  it('maps "nas" to the nas section', () => {
    expect(resolveStartView('nas')).toBe('nas')
  })
  it('maps "shows" to the shows section', () => {
    expect(resolveStartView('shows')).toBe('shows')
  })
  it('falls back to the hub for an unknown token', () => {
    expect(resolveStartView('wibble')).toBe('hub')
  })
  it('falls back to the hub for an empty token (default cold open)', () => {
    expect(resolveStartView('')).toBe('hub')
  })
})
