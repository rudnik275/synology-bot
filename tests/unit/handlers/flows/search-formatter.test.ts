import { describe, it, expect } from 'bun:test'
import { formatSearchResults } from '../../../../src/handlers/flows/search-formatter.ts'
import type { TolokaResult } from '../../../../src/infra/toloka/types.ts'
import type { InlineKeyboardButton } from 'grammy/types'

type CallbackButton = InlineKeyboardButton.CallbackButton

function makeResult(overrides: Partial<TolokaResult> = {}): TolokaResult {
  return {
    id: '1',
    title: 'Test Movie',
    downloadUrl: 'https://toloka.to/download.php?id=1',
    size: '1.0 GB',
    seeders: 100,
    leechers: 5,
    category: 'Фільми',
    ...overrides,
  }
}

describe('formatSearchResults', () => {
  it('returns text with query and result count', () => {
    const results = [makeResult()]
    const { text } = formatSearchResults('ubuntu', results)
    expect(text).toContain('ubuntu')
    expect(text).toContain('1')
  })

  it('returns inline keyboard with one button per result plus back button', () => {
    const results = [makeResult({ id: '42', title: 'My Movie', size: '2 GB', seeders: 55, leechers: 3 })]
    const { inlineKeyboard } = formatSearchResults('query', results)

    // 1 result row + 1 back row
    expect(inlineKeyboard.length).toBe(2)

    const firstRow = inlineKeyboard[0]!
    expect(firstRow.length).toBe(1)
    const btn = firstRow[0]!
    expect(btn.text).toContain('My Movie')
    expect(btn.text).toContain('2 GB')
    expect(btn.text).toContain('55')
    expect(btn.callback_data).toBe('search_pick:42')
  })

  it('sorts results by seeders descending', () => {
    const results = [
      makeResult({ id: '1', title: 'Low Seeds', seeders: 10 }),
      makeResult({ id: '2', title: 'High Seeds', seeders: 500 }),
      makeResult({ id: '3', title: 'Mid Seeds', seeders: 200 }),
    ]
    const { inlineKeyboard } = formatSearchResults('test', results)

    // First row should be High Seeds
    expect(inlineKeyboard[0]![0]!.callback_data).toBe('search_pick:2')
    expect(inlineKeyboard[1]![0]!.callback_data).toBe('search_pick:3')
    expect(inlineKeyboard[2]![0]!.callback_data).toBe('search_pick:1')
  })

  it('limits results to 10', () => {
    const results = Array.from({ length: 15 }, (_, i) =>
      makeResult({ id: String(i), title: `Movie ${i}`, seeders: i })
    )
    const { inlineKeyboard } = formatSearchResults('test', results)

    // 10 results + 1 back button
    expect(inlineKeyboard.length).toBe(11)
  })

  it('includes back button as last keyboard row', () => {
    const results = [makeResult()]
    const { inlineKeyboard } = formatSearchResults('test', results)

    const lastRow = inlineKeyboard[inlineKeyboard.length - 1]!
    expect(lastRow[0]!.callback_data).toBe('search_back')
    expect(lastRow[0]!.text).toContain('Назад')
  })

  it('handles empty results array', () => {
    const { inlineKeyboard } = formatSearchResults('test', [])

    // Just back button
    expect(inlineKeyboard.length).toBe(1)
    expect(inlineKeyboard[0]![0]!.callback_data).toBe('search_back')
  })

  it('each result button has correct search_pick callback_data', () => {
    const results = [
      makeResult({ id: 'abc', seeders: 100 }),
      makeResult({ id: 'xyz', seeders: 50 }),
    ]
    const { inlineKeyboard } = formatSearchResults('test', results)

    expect(inlineKeyboard[0]![0]!.callback_data).toBe('search_pick:abc')
    expect(inlineKeyboard[1]![0]!.callback_data).toBe('search_pick:xyz')
  })
})
