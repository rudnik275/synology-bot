import { describe, it, expect } from 'bun:test'
import { extractMagnet } from '../../../src/domain/magnet-extractor.ts'

describe('extractMagnet', () => {
  it('returns a plain magnet URI', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12'
    expect(extractMagnet(magnet)).toBe(magnet)
  })

  it('extracts magnet embedded in surrounding text', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=MyShow'
    const text = `Check this out: ${magnet} great stuff`
    expect(extractMagnet(text)).toBe(magnet)
  })

  it('extracts magnet from forwarded message caption with surrounding text', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Foo&tr=udp%3A%2F%2Ftracker.example.com'
    const text = `Forwarded message:\nSome description here\n${magnet}\nEnd of message`
    expect(extractMagnet(text)).toBe(magnet)
  })

  it('returns the first magnet when multiple are present', () => {
    const first = 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const second = 'magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const text = `${first} and also ${second}`
    expect(extractMagnet(text)).toBe(first)
  })

  it('returns null when no magnet is present', () => {
    expect(extractMagnet('Hello, no magnet here!')).toBeNull()
  })

  it('returns null for malformed magnet missing btih hash', () => {
    expect(extractMagnet('magnet:?xt=urn:btih:')).toBeNull()
  })

  it('handles base32 v2 magnet hashes', () => {
    const magnet = 'magnet:?xt=urn:btih:MFRA2YLNMFRA2YLNMFRA2YLNMFRA2YLN'
    expect(extractMagnet(magnet)).toBe(magnet)
  })

  it('returns null for empty string', () => {
    expect(extractMagnet('')).toBeNull()
  })

  it('matches an uppercase magnet scheme', () => {
    const magnet = 'MAGNET:?XT=URN:BTIH:ABCDEF1234567890ABCDEF1234567890ABCDEF12'
    expect(extractMagnet(magnet)).toBe(magnet)
  })

  it('handles BitTorrent v2 (urn:btmh:) hashes', () => {
    const magnet =
      'magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa3b3a3a3a3a3a3a3a3a3a3a3a3&dn=Foo'
    expect(extractMagnet(magnet)).toBe(magnet)
  })

  it('extracts a magnet embedded mid-sentence with query params intact', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Show&tr=udp%3A%2F%2Ft.example'
    expect(extractMagnet(`Смотри: ${magnet} — годнота`)).toBe(magnet)
  })
})
