import type { TolokaResult } from '../../infra/toloka/types.ts'
import type { InlineKeyboardButton } from 'grammy/types'

type CallbackButton = InlineKeyboardButton.CallbackButton

export interface SearchResultsMessage {
  text: string
  inlineKeyboard: CallbackButton[][]
}

/**
 * Formats up to 10 Toloka search results (sorted by seeders desc) into
 * a Telegram message with inline keyboard.
 * Pure function — no I/O.
 */
export function formatSearchResults(
  query: string,
  results: TolokaResult[]
): SearchResultsMessage {
  const sorted = [...results].sort((a, b) => b.seeders - a.seeders).slice(0, 10)

  const text = `🔍 ${query} — ${sorted.length} результат${pluralizeResults(sorted.length)}`

  const inlineKeyboard: CallbackButton[][] = sorted.map((r) => [
    {
      text: `⬇️ ${r.title} • ${r.size} • ${r.seeders} S / ${r.leechers} L`,
      callback_data: `search_pick:${r.id}`,
    },
  ])

  inlineKeyboard.push([
    {
      text: '↩️ Назад',
      callback_data: 'search_back',
    },
  ])

  return { text, inlineKeyboard }
}

function pluralizeResults(n: number): string {
  if (n === 1) return ''
  return 'ів'
}
