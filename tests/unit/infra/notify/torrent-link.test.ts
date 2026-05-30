import { describe, it, expect } from 'bun:test'
import {
  miniAppTorrentUrl,
  openTorrentButton,
  STASH_PARAM_PREFIX,
} from '../../../../src/infra/notify/miniapp-link.ts'

describe('miniAppTorrentUrl', () => {
  it('encodes the token with the tor- prefix as the start param', () => {
    const url = miniAppTorrentUrl('https://app.example', 'abc123')
    expect(url).toBe(
      'https://app.example?tgWebAppStartParam=tor-abc123&startapp=tor-abc123'
    )
  })

  it('uses & when the base URL already has a query string', () => {
    const url = miniAppTorrentUrl('https://app.example?x=1', 'abc123')
    expect(url).toBe(
      'https://app.example?x=1&tgWebAppStartParam=tor-abc123&startapp=tor-abc123'
    )
  })

  it('returns undefined when miniappUrl is empty (Mini App not configured)', () => {
    expect(miniAppTorrentUrl('', 'abc123')).toBeUndefined()
  })

  it('STASH_PARAM_PREFIX is "tor-"', () => {
    expect(STASH_PARAM_PREFIX).toBe('tor-')
  })
})

describe('openTorrentButton', () => {
  it('builds an InlineKeyboard with an Открыть web_app button to the token URL', () => {
    const kb = openTorrentButton('https://app.example', 'abc123')!
    const buttons = kb.inline_keyboard.flat() as Array<{ text: string; web_app?: { url: string } }>
    expect(buttons[0]?.text).toBe('Открыть')
    expect(buttons[0]?.web_app?.url).toContain('tgWebAppStartParam=tor-abc123')
  })

  it('returns undefined when miniappUrl is empty', () => {
    expect(openTorrentButton('', 'abc123')).toBeUndefined()
  })
})
