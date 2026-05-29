import { describe, it, expect } from 'bun:test'
import { openMiniAppButton, categoryToTab } from '../../../../src/infra/notify/miniapp-link.ts'

describe('categoryToTab', () => {
  it('maps torrents → downloads', () => {
    expect(categoryToTab('torrents')).toBe('downloads')
  })
  it('maps health → nas', () => {
    expect(categoryToTab('health')).toBe('nas')
  })
  it('maps deploy → nas', () => {
    expect(categoryToTab('deploy')).toBe('nas')
  })
  it('maps subscriptions → shows', () => {
    expect(categoryToTab('subscriptions')).toBe('shows')
  })
})

describe('openMiniAppButton', () => {
  it('returns undefined when miniappUrl is empty (button-less pushes)', () => {
    expect(openMiniAppButton('', 'downloads')).toBeUndefined()
  })

  it('builds a web_app "Открыть" button encoding the tab as start param', () => {
    const kb = openMiniAppButton('https://nas.example.com', 'nas')
    expect(kb).toBeDefined()
    const rows = kb!.inline_keyboard
    // single button row
    const btn = rows[0][0] as { text: string; web_app: { url: string } }
    expect(btn.text).toBe('Открыть')
    expect(btn.web_app.url).toContain('tgWebAppStartParam=nas')
  })

  it('encodes downloads tab', () => {
    const kb = openMiniAppButton('https://nas.example.com', 'downloads')
    const btn = kb!.inline_keyboard[0][0] as { web_app: { url: string } }
    expect(btn.web_app.url).toContain('tgWebAppStartParam=downloads')
  })

  it('encodes shows tab', () => {
    const kb = openMiniAppButton('https://nas.example.com', 'shows')
    const btn = kb!.inline_keyboard[0][0] as { web_app: { url: string } }
    expect(btn.web_app.url).toContain('tgWebAppStartParam=shows')
  })

  it('preserves the configured base url', () => {
    const kb = openMiniAppButton('https://nas.example.com/app', 'nas')
    const btn = kb!.inline_keyboard[0][0] as { web_app: { url: string } }
    expect(btn.web_app.url).toContain('https://nas.example.com/app')
  })
})
