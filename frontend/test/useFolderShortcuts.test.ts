// Tests for useFolderShortcuts composable (#96): last folder + recent/favorite chips.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { useFolderShortcuts } from '../src/composables/useFolderShortcuts'

const KEY_RECENTS = 'nas-bot:folder-recents'
const KEY_FAVORITES = 'nas-bot:folder-favorites'
const KEY_LAST = 'nas-bot:last-folder'

function clearStorage() {
  localStorage.removeItem(KEY_RECENTS)
  localStorage.removeItem(KEY_FAVORITES)
  localStorage.removeItem(KEY_LAST)
}

describe('useFolderShortcuts', () => {
  beforeEach(clearStorage)
  afterEach(clearStorage)

  it('starts with empty recents and favorites when nothing stored', () => {
    const { recents, favorites, lastFolder } = useFolderShortcuts()
    expect(recents.value).toEqual([])
    expect(favorites.value).toEqual([])
    expect(lastFolder.value).toBeNull()
  })

  it('recordRecent stores path and sets lastFolder', () => {
    const { recents, lastFolder, recordRecent } = useFolderShortcuts()
    recordRecent('/volume1/downloads')
    expect(recents.value).toEqual(['/volume1/downloads'])
    expect(lastFolder.value).toBe('/volume1/downloads')
    expect(localStorage.getItem(KEY_RECENTS)).toBe(JSON.stringify(['/volume1/downloads']))
    expect(localStorage.getItem(KEY_LAST)).toBe('/volume1/downloads')
  })

  it('recordRecent deduplicates: moves existing path to front', () => {
    const { recents, recordRecent } = useFolderShortcuts()
    recordRecent('/volume1/a')
    recordRecent('/volume1/b')
    recordRecent('/volume1/a') // duplicate
    expect(recents.value).toEqual(['/volume1/a', '/volume1/b'])
  })

  it('recordRecent caps recents at 6', () => {
    const { recents, recordRecent } = useFolderShortcuts()
    for (let i = 1; i <= 8; i++) {
      recordRecent(`/volume1/folder${i}`)
    }
    expect(recents.value).toHaveLength(6)
    expect(recents.value[0]).toBe('/volume1/folder8')
  })

  it('reads stored data from localStorage on init', () => {
    localStorage.setItem(KEY_RECENTS, JSON.stringify(['/volume1/saved']))
    localStorage.setItem(KEY_LAST, '/volume1/saved')
    const { recents, lastFolder } = useFolderShortcuts()
    expect(recents.value).toEqual(['/volume1/saved'])
    expect(lastFolder.value).toBe('/volume1/saved')
  })

  it('toggleFavorite adds a path to favorites', () => {
    const { favorites, toggleFavorite } = useFolderShortcuts()
    toggleFavorite('/volume1/downloads')
    expect(favorites.value).toContain('/volume1/downloads')
    expect(localStorage.getItem(KEY_FAVORITES)).toBe(JSON.stringify(['/volume1/downloads']))
  })

  it('toggleFavorite removes an already-favorited path', () => {
    const { favorites, toggleFavorite } = useFolderShortcuts()
    toggleFavorite('/volume1/downloads')
    toggleFavorite('/volume1/downloads')
    expect(favorites.value).not.toContain('/volume1/downloads')
  })

  it('is inert when localStorage methods throw', () => {
    // Stub individual methods to throw, rather than replacing the whole descriptor
    const origGetItem = localStorage.getItem
    const origSetItem = localStorage.setItem
    const origRemoveItem = localStorage.removeItem

    localStorage.getItem = () => { throw new Error('quota exceeded') }
    localStorage.setItem = () => { throw new Error('quota exceeded') }
    localStorage.removeItem = () => { throw new Error('quota exceeded') }

    try {
      // Should not throw during init
      const { recents, favorites, lastFolder, recordRecent, toggleFavorite } = useFolderShortcuts()
      expect(recents.value).toEqual([])
      expect(favorites.value).toEqual([])
      expect(lastFolder.value).toBeNull()
      // Calls should be no-ops (no throw)
      expect(() => recordRecent('/volume1/x')).not.toThrow()
      expect(() => toggleFavorite('/volume1/x')).not.toThrow()
    } finally {
      localStorage.getItem = origGetItem
      localStorage.setItem = origSetItem
      localStorage.removeItem = origRemoveItem
    }
  })

  it('clearLastIfMissing removes lastFolder from storage', () => {
    localStorage.setItem(KEY_LAST, '/volume1/old')
    const { lastFolder, clearLastIfMissing } = useFolderShortcuts()
    expect(lastFolder.value).toBe('/volume1/old')
    clearLastIfMissing()
    expect(lastFolder.value).toBeNull()
    expect(localStorage.getItem(KEY_LAST)).toBeNull()
  })
})
