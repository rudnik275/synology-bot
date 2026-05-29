// Smoke tests for the shared component kit (#60). Styles are dropped by the test
// harness, so these assert structure/props/behaviour, not visuals.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import ProgressBar from '../src/components/ProgressBar.vue'
import StickerBadge from '../src/components/StickerBadge.vue'
import EmptyState from '../src/components/EmptyState.vue'
import Sheet from '../src/components/Sheet.vue'
import FAB from '../src/components/FAB.vue'

describe('ProgressBar', () => {
  it('clamps the value into 0–100 and reports it via aria', () => {
    expect(mount(ProgressBar, { props: { value: 150 } }).get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
    expect(mount(ProgressBar, { props: { value: -10 } }).get('[role="progressbar"]').attributes('aria-valuenow')).toBe('0')
  })
})

describe('StickerBadge', () => {
  it('renders slot content and applies the rotation', () => {
    const wrapper = mount(StickerBadge, { props: { rotate: -5 }, slots: { default: 'DONE' } })
    expect(wrapper.text()).toBe('DONE')
    expect(wrapper.attributes('style')).toContain('rotate(-5deg)')
  })
})

describe('EmptyState', () => {
  it('shows title and message', () => {
    const wrapper = mount(EmptyState, { props: { title: 'Nothing', message: 'Add something' } })
    expect(wrapper.text()).toContain('Nothing')
    expect(wrapper.text()).toContain('Add something')
  })
})

describe('FAB', () => {
  it('emits click', async () => {
    const wrapper = mount(FAB)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})

describe('Sheet', () => {
  it('renders nothing when closed and the dialog when open', async () => {
    const closed = mount(Sheet, { props: { open: false } })
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    const open = mount(Sheet, { props: { open: true, title: 'Add' }, slots: { default: 'body' } })
    await open.vm.$nextTick()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('body')

    // closing via the close button emits update:open=false + close
    const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLButtonElement
    closeBtn.click()
    expect(open.emitted('update:open')?.[0]).toEqual([false])
    expect(open.emitted('close')).toHaveLength(1)
    open.unmount()
  })
})
