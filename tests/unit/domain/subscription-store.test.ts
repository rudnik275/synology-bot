import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { PersistentStore } from '../../../src/infra/persistence/store.ts'
import type { Subscription } from '../../../src/domain/subscription.ts'

describe('PersistentStore — subscription helpers', () => {
  let store: PersistentStore

  beforeEach(() => {
    store = new PersistentStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('listSubscriptions returns empty array when no subscriptions', () => {
    expect(store.listSubscriptions()).toEqual([])
  })

  it('addSubscription and listSubscriptions round-trip', () => {
    const sub: Subscription = { id: 'show-1', showId: 1, title: 'Breaking Bad' }
    store.addSubscription(sub)
    const list = store.listSubscriptions()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(sub)
  })

  it('addSubscription stores and retrieves lastNotifiedEpisode', () => {
    const sub: Subscription = {
      id: 'show-42',
      showId: 42,
      title: 'The Wire',
      lastNotifiedEpisode: { season: 3, episode: 7 },
    }
    store.addSubscription(sub)
    const list = store.listSubscriptions()
    expect(list[0].lastNotifiedEpisode).toEqual({ season: 3, episode: 7 })
  })

  it('removeSubscription removes existing entry', () => {
    const sub: Subscription = { id: 'show-5', showId: 5, title: 'Sopranos' }
    store.addSubscription(sub)
    store.removeSubscription('show-5')
    expect(store.listSubscriptions()).toHaveLength(0)
  })

  it('removeSubscription is a no-op for non-existing id', () => {
    expect(() => store.removeSubscription('ghost')).not.toThrow()
  })

  it('getSubscription returns the subscription by id', () => {
    const sub: Subscription = { id: 'show-9', showId: 9, title: 'Deadwood' }
    store.addSubscription(sub)
    expect(store.getSubscription('show-9')).toEqual(sub)
  })

  it('getSubscription returns undefined for unknown id', () => {
    expect(store.getSubscription('nobody')).toBeUndefined()
  })

  it('addSubscription upserts — second add updates the record', () => {
    const sub: Subscription = { id: 'show-3', showId: 3, title: 'Old Title' }
    store.addSubscription(sub)
    const updated: Subscription = { id: 'show-3', showId: 3, title: 'New Title' }
    store.addSubscription(updated)
    const list = store.listSubscriptions()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('New Title')
  })

  it('round-trips poster and latestAiredEpisode (new optional fields)', () => {
    const sub: Subscription = {
      id: 'show-100',
      showId: 100,
      title: 'New Show',
      poster: 'https://img.example.com/poster.jpg',
      latestAiredEpisode: { season: 2, episode: 5, airDate: '2024-09-15T20:00:00Z' },
    }
    store.addSubscription(sub)
    const retrieved = store.getSubscription('show-100')
    expect(retrieved?.poster).toBe('https://img.example.com/poster.jpg')
    expect(retrieved?.latestAiredEpisode).toEqual({ season: 2, episode: 5, airDate: '2024-09-15T20:00:00Z' })
  })

  it('reads an old blob without poster/latestAiredEpisode without throwing', () => {
    // Simulate a pre-existing blob that lacks the new fields (old format)
    const oldBlob = JSON.stringify({ id: 'old-1', showId: 55, title: 'Old Show' })
    store['db'].run('INSERT OR REPLACE INTO subscriptions (id, data) VALUES (?, ?)', ['old-1', oldBlob])
    const retrieved = store.getSubscription('old-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe('Old Show')
    expect(retrieved?.poster).toBeUndefined()
    expect(retrieved?.latestAiredEpisode).toBeUndefined()
  })
})
