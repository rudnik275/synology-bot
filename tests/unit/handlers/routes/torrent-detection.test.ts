import { describe, it, expect } from 'bun:test'
import { isTorrentDocument } from '../../../../src/handlers/input-router.ts'

describe('isTorrentDocument', () => {
  it('returns true when mime_type is application/x-bittorrent', () => {
    expect(isTorrentDocument({ mime_type: 'application/x-bittorrent' })).toBe(true)
  })

  it('returns true when file_name ends with .torrent (lowercase)', () => {
    expect(isTorrentDocument({ file_name: 'ubuntu-22.04.torrent' })).toBe(true)
  })

  it('returns true when file_name ends with .TORRENT (uppercase)', () => {
    expect(isTorrentDocument({ file_name: 'UBUNTU.TORRENT' })).toBe(true)
  })

  it('returns true when both mime and extension match', () => {
    expect(isTorrentDocument({
      mime_type: 'application/x-bittorrent',
      file_name: 'file.torrent',
    })).toBe(true)
  })

  it('returns true when only mime matches but extension is wrong', () => {
    expect(isTorrentDocument({
      mime_type: 'application/x-bittorrent',
      file_name: 'file.bin',
    })).toBe(true)
  })

  it('returns true when only extension matches but mime is wrong', () => {
    expect(isTorrentDocument({
      mime_type: 'application/octet-stream',
      file_name: 'file.torrent',
    })).toBe(true)
  })

  it('returns false when mime is application/pdf and extension is .pdf', () => {
    expect(isTorrentDocument({
      mime_type: 'application/pdf',
      file_name: 'document.pdf',
    })).toBe(false)
  })

  it('returns false when no mime and no file_name', () => {
    expect(isTorrentDocument({})).toBe(false)
  })

  it('returns false when file_name is undefined and mime is wrong', () => {
    expect(isTorrentDocument({ mime_type: 'image/jpeg' })).toBe(false)
  })

  it('returns false when file_name does not end with .torrent', () => {
    expect(isTorrentDocument({ file_name: 'notatorrent.txt' })).toBe(false)
  })
})
