import type { TabKey } from './components/TabBar.vue'

const TABS: readonly TabKey[] = ['downloads', 'nas', 'shows']

/**
 * Resolve a Telegram deep-link start param into a Mini App tab (ADR 0006).
 * Returns the matching TabKey, or 'downloads' for an unknown/empty token.
 */
export function resolveStartTab(raw: string): TabKey {
  return (TABS as readonly string[]).includes(raw) ? (raw as TabKey) : 'downloads'
}
