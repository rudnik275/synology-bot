import { describe, it, expect } from 'bun:test'
import { normalizeDownloadDestination } from '../../../../src/infra/synology/client.ts'

describe('normalizeDownloadDestination', () => {
  it('strips a leading slash from a FileStation path', () => {
    expect(normalizeDownloadDestination('/video/Movies')).toBe('video/Movies')
  })

  it('strips leading slash from a single share name', () => {
    expect(normalizeDownloadDestination('/video')).toBe('video')
  })

  it('is idempotent for an already-relative path', () => {
    expect(normalizeDownloadDestination('video/Movies')).toBe('video/Movies')
  })

  it('strips /volumeN/ prefix and leading slash', () => {
    expect(normalizeDownloadDestination('/volume1/video/Movies')).toBe('video/Movies')
    expect(normalizeDownloadDestination('/volume2/downloads')).toBe('downloads')
  })

  it('returns empty string for a lone slash', () => {
    expect(normalizeDownloadDestination('/')).toBe('')
  })

  it('returns empty string for an empty input', () => {
    expect(normalizeDownloadDestination('')).toBe('')
  })
})
