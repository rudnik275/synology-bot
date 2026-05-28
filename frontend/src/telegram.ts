// Minimal typing of the Telegram WebApp SDK surface we use.
interface TelegramWebApp {
  initData: string
  ready: () => void
  expand: () => void
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
}

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
}
