import { describe, it, expect } from 'bun:test'
import { parseTorrentToken } from '../src/telegram'

describe('parseTorrentToken', () => {
  it('recovers the token from a tor- prefixed start param', () => {
    expect(parseTorrentToken('tor-abc123')).toBe('abc123')
  })
  it('returns empty for a tab deep-link', () => {
    expect(parseTorrentToken('downloads')).toBe('')
    expect(parseTorrentToken('nas')).toBe('')
  })
  it('returns empty for an empty start param', () => {
    expect(parseTorrentToken('')).toBe('')
  })
})
