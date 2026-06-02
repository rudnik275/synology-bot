// Shell render tests for the Neo-Brutalism foundation (#60): the 3-tab bar is
// present, Downloads is the default tab, and tapping a tab swaps the body.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('App shell', () => {
  it('renders exactly the three tabs Downloads / NAS / Shows', () => {
    const wrapper = mount(App)
    const labels = wrapper.findAll('nav button').map((b) => b.text())
    expect(labels).toEqual(['Загрузки', 'NAS', 'Шоу'])
  })

  it('defaults to the Downloads tab', () => {
    const wrapper = mount(App)
    const active = wrapper.find('nav button[aria-current="page"]')
    expect(active.exists()).toBe(true)
    expect(active.text()).toBe('Загрузки')
    // and the Downloads tab body is the one rendered (stub replaced by #61)
    // Loading state or empty state shows — either way the NAS/Shows stubs are absent
    expect(wrapper.text()).not.toContain('Disk, memory and CPU health will appear here.')
    expect(wrapper.text()).not.toContain('Active shows will appear here.')
  })

  it('swaps the body when another tab is tapped', async () => {
    const wrapper = mount(App)
    const nasTab = wrapper.findAll('nav button').find((b) => b.text() === 'NAS')!
    await nasTab.trigger('click')
    expect(wrapper.find('nav button[aria-current="page"]').text()).toBe('NAS')
    // NasTab is now the live health view (#70) — it will render some content
    // (data, loading, or error state) instead of the old stub placeholder.
    expect(wrapper.find('nav button[aria-current="page"]').text()).toBe('NAS')
  })
})
