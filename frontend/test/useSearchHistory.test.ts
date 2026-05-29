// Tests for useSearchHistory composable (#98): search history MRU + localStorage.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { useSearchHistory } from '../src/composables/useSearchHistory'

const KEY = 'nas-bot:search-history'

function clearStorage() {
  localStorage.removeItem(KEY)
}

describe('useSearchHistory', () => {
  beforeEach(clearStorage)
  afterEach(clearStorage)

  it('starts with empty history when nothing stored', () => {
    const { history } = useSearchHistory()
    expect(history.value).toEqual([])
  })

  it('recordQuery stores trimmed query and reads back', () => {
    const { history, recordQuery } = useSearchHistory()
    recordQuery('Breaking Bad')
    expect(history.value).toEqual(['Breaking Bad'])
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(['Breaking Bad']))
  })

  it('recordQuery trims whitespace before storing', () => {
    const { history, recordQuery } = useSearchHistory()
    recordQuery('  Stranger Things  ')
    expect(history.value[0]).toBe('Stranger Things')
  })

  it('recordQuery ignores empty/whitespace-only queries', () => {
    const { history, recordQuery } = useSearchHistory()
    recordQuery('')
    recordQuery('   ')
    expect(history.value).toEqual([])
  })

  it('recordQuery deduplicates case-insensitively (most recent form wins)', () => {
    const { history, recordQuery } = useSearchHistory()
    recordQuery('Breaking Bad')
    recordQuery('BREAKING BAD')
    // The newer casing should be at front, old one removed
    expect(history.value).toHaveLength(1)
    expect(history.value[0]).toBe('BREAKING BAD')
  })

  it('recordQuery deduplicates case-insensitively — mixed case', () => {
    const { history, recordQuery } = useSearchHistory()
    recordQuery('the wire')
    recordQuery('something else')
    recordQuery('The Wire') // duplicate, different case
    expect(history.value).toHaveLength(2)
    expect(history.value[0]).toBe('The Wire')
    expect(history.value[1]).toBe('something else')
  })

  it('recordQuery caps history at 10', () => {
    const { history, recordQuery } = useSearchHistory()
    for (let i = 1; i <= 12; i++) {
      recordQuery(`Show ${i}`)
    }
    expect(history.value).toHaveLength(10)
    expect(history.value[0]).toBe('Show 12')
  })

  it('reads stored data from localStorage on init', () => {
    localStorage.setItem(KEY, JSON.stringify(['Lost', 'House M.D.']))
    const { history } = useSearchHistory()
    expect(history.value).toEqual(['Lost', 'House M.D.'])
  })

  it('clearHistory empties history and removes localStorage key', () => {
    const { history, recordQuery, clearHistory } = useSearchHistory()
    recordQuery('Sopranos')
    recordQuery('Dexter')
    clearHistory()
    expect(history.value).toEqual([])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('is inert when localStorage methods throw during init', () => {
    const origGetItem = localStorage.getItem
    const origSetItem = localStorage.setItem
    const origRemoveItem = localStorage.removeItem

    localStorage.getItem = () => { throw new Error('quota exceeded') }
    localStorage.setItem = () => { throw new Error('quota exceeded') }
    localStorage.removeItem = () => { throw new Error('quota exceeded') }

    try {
      const { history, recordQuery, clearHistory } = useSearchHistory()
      expect(history.value).toEqual([])
      // These should be no-ops, not throw
      expect(() => recordQuery('Test')).not.toThrow()
      expect(() => clearHistory()).not.toThrow()
    } finally {
      localStorage.getItem = origGetItem
      localStorage.setItem = origSetItem
      localStorage.removeItem = origRemoveItem
    }
  })

  it('handles malformed JSON in localStorage gracefully', () => {
    localStorage.setItem(KEY, 'not-valid-json{{{')
    const { history } = useSearchHistory()
    expect(history.value).toEqual([])
  })
})
