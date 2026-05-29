import { describe, it, expect, mock } from 'bun:test'
import { resolveStartTab } from '../src/startTab'

describe('resolveStartTab', () => {
  it('maps "downloads" to the downloads tab', () => {
    expect(resolveStartTab('downloads')).toBe('downloads')
  })
  it('maps "nas" to the nas tab', () => {
    expect(resolveStartTab('nas')).toBe('nas')
  })
  it('maps "shows" to the shows tab', () => {
    expect(resolveStartTab('shows')).toBe('shows')
  })
  it('falls back to downloads for an unknown token', () => {
    expect(resolveStartTab('wibble')).toBe('downloads')
  })
  it('falls back to downloads for an empty token', () => {
    expect(resolveStartTab('')).toBe('downloads')
  })
})

describe('App boot deep-link', () => {
  it('opens the tab named by the start param on mount', async () => {
    // Stub the resolved start param so the shell boots on the NAS tab. App.vue
    // computes its initial tab from telegram.startParam via resolveStartTab.
    mock.module('../src/telegram', () => ({
      startParam: 'nas',
      initData: '',
      inTelegram: false,
      initTelegram: () => {},
    }))
    const { mount } = await import('@vue/test-utils')
    const App = (await import('../src/App.vue')).default
    const wrapper = mount(App)
    expect(wrapper.find('nav button[aria-current="page"]').text()).toBe('NAS')
  })
})
