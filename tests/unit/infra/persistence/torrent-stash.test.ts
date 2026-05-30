import { describe, it, expect } from 'bun:test'
import { PersistentStore } from '../../../../src/infra/persistence/store.ts'

function freshStore(): PersistentStore {
  return new PersistentStore(':memory:')
}

const BYTES = new Uint8Array([0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e]) // "d8:ann" — torrent-ish

describe('PersistentStore torrent stash', () => {
  it('round-trips a stashed torrent by token', () => {
    const store = freshStore()
    store.stashTorrent('tok-1', 'movie.torrent', BYTES, 60_000)

    const got = store.getTorrentStash('tok-1')
    expect(got).toBeDefined()
    expect(got!.fileName).toBe('movie.torrent')
    expect(Array.from(got!.data)).toEqual(Array.from(BYTES))
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

  it('migration creates the torrent_stash table (user_version >= 2)', () => {
    const store = freshStore()
    expect(store.getUserVersion()).toBeGreaterThanOrEqual(2)
  })
})
