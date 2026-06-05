// Minimal typing of the Telegram WebApp SDK surface we use.
interface TelegramWebApp {
  initData: string
  // Parsed init data; `start_param` carries the deep-link tab token (ADR 0006).
  initDataUnsafe?: { start_param?: string }
  ready: () => void
  expand: () => void
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  // Optional across client versions — call sites guard with `typeof`.
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  // BackButton for detail navigation (ADR 0009)
  BackButton?: {
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
}

// The Neo-Brutalism cream. Kept in sync with --cream in styles/tokens.css; used to
// paint Telegram's native chrome so it matches the app (we ignore the TG theme).
const CREAM = '#fffdf5'

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const tg = window.Telegram?.WebApp

/** The raw initData string sent as `Authorization: tma <initData>`. Empty outside Telegram. */
export const initData = tg?.initData ?? ''

/** True when running inside the Telegram webview (vs. a bare browser during dev). */
export const inTelegram = Boolean(tg)

/**
 * Deep-link start param (ADR 0006). Read ONLY from the launch URL
 * (`tgWebAppStartParam`/`startapp`, query or hash), NOT from
 * `initDataUnsafe.start_param`: iOS/iPadOS Telegram replays the last deep-link's
 * start_param on later menu-button opens, which booted the app into NAS after a
 * NAS alert instead of the hub (#255). The bot embeds the param in every
 * deep-link URL (miniapp-link.ts), so the URL is the replay-free source — and it
 * keeps dev/testing working outside Telegram.
 */
export function resolveStartParam(search: string, hash: string): string {
  const q = new URLSearchParams(search)
  const h = new URLSearchParams(hash.replace(/^#/, ''))
  return (
    q.get('tgWebAppStartParam') ??
    q.get('startapp') ??
    h.get('tgWebAppStartParam') ??
    h.get('startapp') ??
    ''
  )
}

export const startParam = resolveStartParam(location.search, location.hash)

// Mirrors STASH_PARAM_PREFIX in src/infra/notify/miniapp-link.ts: the bot
// deep-links a forwarded .torrent as `tor-<token>` (#99).
const STASH_PREFIX = 'tor-'

/** Recover the stash token from a `tor-<token>` deep-link, or '' for anything else. */
export function parseTorrentToken(raw: string): string {
  return raw.startsWith(STASH_PREFIX) ? raw.slice(STASH_PREFIX.length) : ''
}

/** Stash token when the Mini App was opened from a forwarded .torrent (#99); '' otherwise. */
export const torrentToken = parseTorrentToken(startParam)

export function initTelegram(): void {
  if (!tg) return
  tg.ready()
  tg.expand()
  // Paint native chrome cream to match the app. We do NOT read themeParams /
  // bind --tg-theme-* — single light mode is the identity (ADR 0006).
  tg.setHeaderColor?.(CREAM)
  tg.setBackgroundColor?.(CREAM)
  // The app scrolls its own content; the webview's pull-to-collapse fights that.
  tg.disableVerticalSwipes?.()
}
