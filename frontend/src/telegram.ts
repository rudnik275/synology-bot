// Minimal typing of the Telegram WebApp SDK surface we use.
interface TelegramWebApp {
  initData: string
  ready: () => void
  expand: () => void
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  // Optional across client versions — call sites guard with `typeof`.
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  disableVerticalSwipes?: () => void
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
