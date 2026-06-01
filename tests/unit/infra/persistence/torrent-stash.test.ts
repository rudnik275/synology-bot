import { describe, it, expect } from 'bun:test'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'

function freshStore(): PersistentStore {
  return new PersistentStore(':memory:')
}

const BYTES = new Uint8Array([0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e]) // "d8:ann" — torrent-ish

describe('PersistentStore add-intake stash', () => {
  it('round-trips a stashed torrent (bytes) by token', () => {
    const store = freshStore()
    store.stashTorrent('tok-1', 'movie.torrent', BYTES, 60_000)

    const got = store.getTorrentStash('tok-1')
    expect(got).toBeDefined()
    if (got?.kind !== 'bytes') throw new Error('expected bytes stash')
    expect(got.fileName).toBe('movie.torrent')
    expect(Array.from(got.data)).toEqual(Array.from(BYTES))
  })

  it('round-trips a stashed URI (magnet) by token (#120)', () => {
    const store = freshStore()
    const magnet = 'magnet:?xt=urn:btih:abc123&dn=Big+Buck+Bunny'
    store.stashUri('tok-uri', magnet, 60_000)

    const got = store.getTorrentStash('tok-uri')
    expect(got).toBeDefined()
    if (got?.kind !== 'uri') throw new Error('expected uri stash')
    expect(got.uri).toBe(magnet)
  })

  it('round-trips a stashed http(s) URL by token (#120)', () => {
    const store = freshStore()
    const url = 'https://tracker.example/file.torrent'
    store.stashUri('tok-url', url, 60_000)

    const got = store.getTorrentStash('tok-url')
    if (got?.kind !== 'uri') throw new Error('expected uri stash')
    expect(got.uri).toBe(url)
  })

  it('a URI stash is not mistaken for a bytes stash', () => {
    const store = freshStore()
    store.stashUri('tok-uri', 'magnet:?xt=urn:btih:zzz', 60_000)
    const got = store.getTorrentStash('tok-uri')
    if (got === undefined) throw new Error('expected a stash')
    expect(got.kind).toBe('uri')
    // No bytes payload leaks through the discriminated shape.
    expect('data' in got).toBe(false)
  })

  it('an expired URI stash is treated as gone (#120)', () => {
    const store = freshStore()
    store.stashUri('tok-old-uri', 'magnet:?xt=urn:btih:old', -1)
    expect(store.getTorrentStash('tok-old-uri')).toBeUndefined()
  })

  it('returns undefined for an unknown token', () => {
    const store = freshStore()
    expect(store.getTorrentStash('nope')).toBeUndefined()
  })

  it('treats an expired stash as gone (ttl already elapsed)', () => {
    const store = freshStore()
    // Negative TTL → expires_at in the past → immediately expired.
    store.stashTorrent('tok-old', 'old.torrent', BYTES, -1)
    expect(store.getTorrentStash('tok-old')).toBeUndefined()
  })

  it('deleteTorrentStash removes the entry', () => {
    const store = freshStore()
    store.stashTorrent('tok-2', 'x.torrent', BYTES, 60_000)
    store.deleteTorrentStash('tok-2')
    expect(store.getTorrentStash('tok-2')).toBeUndefined()
  })

  it('pruneExpiredStashes drops only expired rows', () => {
    const store = freshStore()
    store.stashTorrent('live', 'a.torrent', BYTES, 60_000)
    store.stashTorrent('dead', 'b.torrent', BYTES, -1)
    store.pruneExpiredStashes()
    expect(store.getTorrentStash('live')).toBeDefined()
    expect(store.getTorrentStash('dead')).toBeUndefined()
  })

  it('migration creates the generalized torrent_stash table (user_version >= 3)', () => {
    const store = freshStore()
    expect(store.getUserVersion()).toBeGreaterThanOrEqual(3)
  })
})
