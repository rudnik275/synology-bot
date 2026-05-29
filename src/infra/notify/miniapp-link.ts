import { InlineKeyboard } from 'grammy'
import type { Category } from './categories.ts'

/** The three Mini App tabs (mirrors frontend TabKey). */
export type Tab = 'downloads' | 'nas' | 'shows'

/**
 * Deep-link map (ADR 0006): push category → target Mini App tab.
 *   torrents      → downloads
 *   health        → nas
 *   deploy        → nas
 *   subscriptions → shows
 */
export function categoryToTab(category: Category): Tab {
  switch (category) {
    case 'torrents':
      return 'downloads'
    case 'health':
    case 'deploy':
      return 'nas'
    case 'subscriptions':
      return 'shows'
  }
}

/**
 * Build the "Открыть" web_app button that deep-links into a specific Mini App
 * tab. Returns `undefined` when `miniappUrl` is empty so that pushes stay
 * button-less when the Mini App is not configured (MINIAPP_URL unset) — this is
 * the guard that keeps existing notifier behavior/tests unchanged.
 *
 * The tab is encoded as `?tgWebAppStartParam=<tab>` (Telegram surfaces it as
 * `initDataUnsafe.start_param`); `&startapp=<tab>` is appended too so the URL is
 * also resolvable from a bare browser during dev.
 */
export function openMiniAppButton(miniappUrl: string, tab: Tab): InlineKeyboard | undefined {
  const url = miniAppTabUrl(miniappUrl, tab)
  if (!url) return undefined
  return new InlineKeyboard().webApp('Открыть', url)
}

/**
 * The deep-link URL for a given tab, or `undefined` when `miniappUrl` is empty.
 * Use this to merge an Открыть button into an existing keyboard (e.g. the
 * task-action keyboard) rather than replacing it.
 */
export function miniAppTabUrl(miniappUrl: string, tab: Tab): string | undefined {
  if (!miniappUrl) return undefined
  const sep = miniappUrl.includes('?') ? '&' : '?'
  return `${miniappUrl}${sep}tgWebAppStartParam=${tab}&startapp=${tab}`
}
