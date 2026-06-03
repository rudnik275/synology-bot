// Dependency-free bencode decoder + .torrent file-list parser (#161).
//
// Why this exists: reaching Confirm used to call DSM `create_list` and POLL for
// ~5–10s while DSM parsed the torrent metadata before the file tree appeared.
// We already hold the .torrent BYTES on the bot for uploaded/Toloka sources, so
// we parse the file tree LOCALLY (bencode, ~1ms) and skip the poll entirely.
//
// The index-parity guarantee is the load-bearing invariant here: the .torrent
// spec stores `info.files` in a FIXED order, and DSM enumerates that same list
// 0-based — so our locally-derived index equals DSM's `index`. The order tests
// below lock that in.
import { describe, it, expect } from 'bun:test'
import { decodeBencode, parseTorrentFiles } from '../../../src/infra/torrent/bencode.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('decodeBencode', () => {
  it('decodes an integer', () => {
    expect(decodeBencode(enc('i42e'))).toBe(42)
  })

  it('decodes a negative integer', () => {
    expect(decodeBencode(enc('i-7e'))).toBe(-7)
  })

  it('decodes a byte-string into raw bytes', () => {
    const v = decodeBencode(enc('4:spam'))
    expect(v).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(v as Uint8Array)).toBe('spam')
  })

  it('decodes an empty byte-string', () => {
    const v = decodeBencode(enc('0:'))
    expect(v).toBeInstanceOf(Uint8Array)
    expect((v as Uint8Array).length).toBe(0)
  })

  it('decodes a list preserving order', () => {
    const v = decodeBencode(enc('l3:foo3:bari1ee')) as unknown[]
    expect(Array.isArray(v)).toBe(true)
    expect(v).toHaveLength(3)
    expect(new TextDecoder().decode(v[0] as Uint8Array)).toBe('foo')
    expect(new TextDecoder().decode(v[1] as Uint8Array)).toBe('bar')
    expect(v[2]).toBe(1)
  })

  it('decodes a dict, keeping keys as a Map in insertion order', () => {
    const v = decodeBencode(enc('d3:cow3:moo4:spam4:eggse')) as Map<string, unknown>
    expect(v).toBeInstanceOf(Map)
    expect([...v.keys()]).toEqual(['cow', 'spam']) // insertion order preserved
    expect(new TextDecoder().decode(v.get('cow') as Uint8Array)).toBe('moo')
    expect(new TextDecoder().decode(v.get('spam') as Uint8Array)).toBe('eggs')
  })

  it('round-trips a nested multi-file info structure', () => {
    // d4:infod5:filesl d6:lengthi100e4:pathl3:dir5:a.mp4e e d6:lengthi200e4:pathl5:b.mp4e e e 4:name3:top e e
    const bytes = enc('d4:infod5:filesld6:lengthi100e4:pathl3:dir5:a.mp4eed6:lengthi200e4:pathl5:b.mp4eee4:name3:topee')
    const root = decodeBencode(bytes) as Map<string, unknown>
    expect(root).toBeInstanceOf(Map)
    const info = root.get('info') as Map<string, unknown>
    expect(info).toBeInstanceOf(Map)
    expect(new TextDecoder().decode(info.get('name') as Uint8Array)).toBe('top')
    const files = info.get('files') as unknown[]
    expect(files).toHaveLength(2)
    const f0 = files[0] as Map<string, unknown>
    expect(f0.get('length')).toBe(100)
    const path0 = (f0.get('path') as Uint8Array[]).map((s) => new TextDecoder().decode(s))
    expect(path0).toEqual(['dir', 'a.mp4'])
  })
})

describe('parseTorrentFiles', () => {
  it('returns multi-file entries in info.files order with paths joined by "/"', () => {
    const bytes = enc('d4:infod5:filesld6:lengthi100e4:pathl3:dir5:a.mp4eed6:lengthi200e4:pathl5:b.mp4eee4:name3:topee')
    expect(parseTorrentFiles(bytes)).toEqual([
      { path: 'dir/a.mp4', length: 100 },
      { path: 'b.mp4', length: 200 },
    ])
  })

  it('preserves info.files order even when paths sort differently (index parity)', () => {
    // z.mp4 first, a.mp4 second — the RETURNED order must follow info.files, not name.
    const bytes = enc('d4:infod5:filesld6:lengthi9e4:pathl5:z.mp4eed6:lengthi8e4:pathl5:a.mp4eee4:name3:topee')
    const files = parseTorrentFiles(bytes)
    expect(files.map((f) => f.path)).toEqual(['z.mp4', 'a.mp4'])
  })

  it('returns a single entry for a single-file torrent (info.name + info.length)', () => {
    // d4:infod6:lengthi500e4:name9:movie.mkvee
    const bytes = enc('d4:infod6:lengthi500e4:name9:movie.mkvee')
    expect(parseTorrentFiles(bytes)).toEqual([{ path: 'movie.mkv', length: 500 }])
  })

  it('decodes UTF-8 path segments', () => {
    const name = 'Фильм.mkv'
    const nameBytes = new TextEncoder().encode(name)
    // Build single-file torrent with a UTF-8 name; len is byte-length, not char count.
    const bytes = enc(`d4:infod6:lengthi5e4:name${nameBytes.length}:`)
    const full = new Uint8Array(bytes.length + nameBytes.length + 'ee'.length)
    full.set(bytes, 0)
    full.set(nameBytes, bytes.length)
    full.set(enc('ee'), bytes.length + nameBytes.length)
    expect(parseTorrentFiles(full)).toEqual([{ path: name, length: 5 }])
  })
})
