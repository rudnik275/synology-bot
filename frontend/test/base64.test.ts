// Unit tests for lib/base64 (#177): the bot-handoff bytes→File reconstruction.
// Extracted from AddFlow.base64ToFile (#99). Pure, no DOM/Telegram dependency.
import { describe, it, expect } from 'bun:test'
import { base64ToFile } from '../src/lib/base64'

describe('base64ToFile', () => {
  it('decodes base64 back to the original bytes', async () => {
    const original = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const base64 = btoa(String.fromCharCode(...original))
    const file = base64ToFile(base64, 'Forwarded.torrent')
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([...bytes]).toEqual([...original])
  })

  it('uses the given name and the bittorrent MIME type', () => {
    const file = base64ToFile(btoa('hello'), 'My File.torrent')
    expect(file.name).toBe('My File.torrent')
    expect(file.type).toBe('application/x-bittorrent')
  })

  it('round-trips bytes that include high/zero values', async () => {
    const original = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x00])
    const base64 = btoa(String.fromCharCode(...original))
    const file = base64ToFile(base64, 't.torrent')
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([...bytes]).toEqual([...original])
  })

  it('produces a File whose size matches the decoded byte length', () => {
    const original = new Uint8Array([10, 20, 30, 40, 50, 60])
    const file = base64ToFile(btoa(String.fromCharCode(...original)), 't.torrent')
    expect(file.size).toBe(original.length)
  })

  it('produces an empty File for an empty base64 string', () => {
    const file = base64ToFile('', 'empty.torrent')
    expect(file.size).toBe(0)
    expect(file.name).toBe('empty.torrent')
  })
})
