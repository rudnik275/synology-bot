// Shell render tests for the Neo-Brutalism foundation (#60): the 3-tab bar is
// present, Downloads is the default tab, the header health-chip is present, and
// tapping a tab swaps the body.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('App shell', () => {
  it('renders exactly the three tabs Downloads / NAS / Shows', () => {
    const wrapper = mount(App)
    const labels = wrapper.findAll('nav button').map((b) => b.text())
    expect(labels).toEqual(['Downloads', 'NAS', 'Shows'])
  })

  it('defaults to the Downloads tab', () => {
    const wrapper = mount(App)
    const active = wrapper.find('nav button[aria-current="page"]')
    expect(active.exists()).toBe(true)
    expect(active.text()).toBe('Downloads')
    // and the Downloads body is the one rendered
    expect(wrapper.text()).toContain('Active downloads will appear here.')
  })

  it('renders the header health-chip', () => {
    const wrapper = mount(App)
    expect(wrapper.find('button[aria-label="NAS health"]').exists()).toBe(true)
  })

  it('swaps the body when another tab is tapped', async () => {
    const wrapper = mount(App)
    const nasTab = wrapper.findAll('nav button').find((b) => b.text() === 'NAS')!
    await nasTab.trigger('click')
    expect(wrapper.find('nav button[aria-current="page"]').text()).toBe('NAS')
    expect(wrapper.text()).toContain('Disk, memory and CPU health will appear here.')
  })

  it('health-chip jumps to the NAS tab', async () => {
    const wrapper = mount(App)
    await wrapper.find('button[aria-label="NAS health"]').trigger('click')
    expect(wrapper.find('nav button[aria-current="page"]').text()).toBe('NAS')
  })
})
