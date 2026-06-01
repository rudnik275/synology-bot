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

/**
 * Prefix that marks a `start_param` as an add-intake stash handoff rather than
 * a tab name. Introduced for `.torrent` bytes (#99) and now also carries
 * magnet/URL stashes (#120) — the token is opaque, the payload kind is resolved
 * server-side by the stash reader, so one prefix covers both. The Mini App
 * strips this to recover the stash token; an unknown tab token already falls
 * back to Downloads (where AddFlow lives), so tab routing needs no change.
 */
export const STASH_PARAM_PREFIX = 'tor-'

/**
 * Deep-link URL that opens the Mini App on a stashed add-intake (#99, #120). The
 * stash token is carried as `start_param = tor-<token>`. Returns `undefined`
 * when `miniappUrl` is empty (Mini App not configured).
 */
export function miniAppStashUrl(miniappUrl: string, token: string): string | undefined {
  if (!miniappUrl) return undefined
  const sep = miniappUrl.includes('?') ? '&' : '?'
  const param = `${STASH_PARAM_PREFIX}${token}`
  return `${miniappUrl}${sep}tgWebAppStartParam=${param}&startapp=${param}`
}

/** @deprecated #99 name; use {@link miniAppStashUrl}. Kept as an alias for callers/tests. */
export const miniAppTorrentUrl = miniAppStashUrl

/**
 * The "Открыть" web_app button deep-linking a stashed add-intake (a `.torrent`'s
 * bytes or a magnet/URL), or `undefined` when the Mini App is unconfigured.
 */
export function openStashButton(miniappUrl: string, token: string): InlineKeyboard | undefined {
  const url = miniAppStashUrl(miniappUrl, token)
  if (!url) return undefined
  return new InlineKeyboard().webApp('Открыть', url)
}

/** @deprecated #99 name; use {@link openStashButton}. Kept as an alias for callers/tests. */
export const openTorrentButton = openStashButton
