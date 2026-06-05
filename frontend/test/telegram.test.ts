import { describe, it, expect } from 'bun:test'
import { parseTorrentToken, resolveStartParam } from '../src/telegram'

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

describe('resolveStartParam', () => {
  // The fix for #255: iOS Telegram replays initDataUnsafe.start_param on
  // menu-button opens, causing the wrong tab to load. resolveStartParam reads
  // ONLY from the launch URL (query + hash) — initDataUnsafe is never consulted.
  // The pure-function signature enforces this: there is no way to pass
  // initDataUnsafe.start_param into it by design.

  it('returns empty string when search and hash are both empty (→ hub)', () => {
    expect(resolveStartParam('', '')).toBe('')
  })

  it('reads tgWebAppStartParam from query string', () => {
    expect(resolveStartParam('?tgWebAppStartParam=nas', '')).toBe('nas')
  })

  it('reads startapp from query string', () => {
    expect(resolveStartParam('?startapp=downloads', '')).toBe('downloads')
  })

  it('reads tgWebAppStartParam from hash when absent from query', () => {
    expect(resolveStartParam('', '#tgWebAppStartParam=shows')).toBe('shows')
  })

  it('reads startapp from hash when absent from query', () => {
    expect(resolveStartParam('', '#startapp=nas')).toBe('nas')
  })

  it('prefers query over hash when both present', () => {
    expect(resolveStartParam('?tgWebAppStartParam=downloads', '#tgWebAppStartParam=nas')).toBe('downloads')
  })

  it('supports tor- deep-link token (parseTorrentToken can extract the stash token)', () => {
    const param = resolveStartParam('?tgWebAppStartParam=tor-abc123', '')
    expect(param).toBe('tor-abc123')
    expect(parseTorrentToken(param)).toBe('abc123')
  })
})
