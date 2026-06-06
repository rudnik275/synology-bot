// Smoke tests for the shared component kit (#60). Styles are dropped by the test
// harness, so these assert structure/props/behaviour, not visuals.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import ProgressBar from '../src/components/ui/ProgressBar.vue'
import StickerBadge from '../src/components/ui/StickerBadge.vue'
import EmptyState from '../src/components/ui/EmptyState.vue'
import Sheet from '../src/components/ui/Sheet.vue'
import Button from '../src/components/ui/Button.vue'
import Donut from '../src/components/ui/Donut.vue'
import RingGauge from '../src/components/ui/RingGauge.vue'

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
    const closeBtn = document.querySelector('[aria-label="Закрыть"]') as HTMLButtonElement
    closeBtn.click()
    expect(open.emitted('update:open')?.[0]).toEqual([false])
    expect(open.emitted('close')).toHaveLength(1)
    open.unmount()
  })
})

describe('Button', () => {
  it('renders a button with slot text and defaults to neutral/md + type=button', () => {
    const wrapper = mount(Button, { slots: { default: 'Go' } })
    const btn = wrapper.get('button')
    expect(btn.text()).toBe('Go')
    expect(btn.attributes('type')).toBe('button')
    expect(btn.classes()).toContain('v-neutral')
    expect(btn.classes()).toContain('s-md')
    // press is centralised on the shared utility, not re-declared per button
    expect(btn.classes()).toContain('nb-pressable')
  })

  it('maps variant + size to their classes', () => {
    const btn = mount(Button, { props: { variant: 'primary', size: 'lg' } }).get('button')
    expect(btn.classes()).toContain('v-primary')
    expect(btn.classes()).toContain('s-lg')
  })

  it('passes data-testid / disabled through to the native button', () => {
    const btn = mount(Button, {
      attrs: { 'data-testid': 'go-btn', disabled: true },
      slots: { default: 'Go' },
    }).get('button')
    expect(btn.attributes('data-testid')).toBe('go-btn')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits click when tapped', async () => {
    const wrapper = mount(Button, { slots: { default: 'Go' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})

describe('Donut', () => {
  const segments = [
    { label: 'plex', value: 50, display: '50 u' },
    { label: 'docker', value: 30, display: '30 u' },
    { label: 'free', value: 20, display: '20 u', muted: true },
  ]

  it('renders the centre value/caption and a legend row per segment', () => {
    const wrapper = mount(Donut, {
      props: { segments, centerValue: '80', centerUnit: 'u', centerCaption: 'of 100 u' },
    })
    expect(wrapper.text()).toContain('80')
    expect(wrapper.text()).toContain('of 100 u')
    const rows = wrapper.findAll('.leg')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('plex')
    expect(rows[0]!.text()).toContain('50 u')
    expect(rows[2]!.classes()).toContain('muted') // "free" is de-emphasised
  })

  it('builds a conic-gradient whose stops are the cumulative proportions', () => {
    const wrapper = mount(Donut, { props: { segments, centerValue: '80' } })
    const bg = (wrapper.get('.donut').attributes('style') ?? '')
    // 50/30/20 of 100 → stops at 50% and 80%
    expect(bg).toContain('conic-gradient')
    expect(bg).toContain('0% 50%')
    expect(bg).toContain('50% 80%')
    expect(bg).toContain('80% 100%')
  })
})

describe('RingGauge', () => {
  it('renders the clamped value with a conic sweep at that percentage', () => {
    const wrapper = mount(RingGauge, { props: { value: 142, tone: 'green' } })
    expect(wrapper.find('.ring').text()).toContain('100')
    const bg = wrapper.get('.ring').attributes('style') ?? ''
    expect(bg).toContain('conic-gradient')
    expect(bg).toContain('100%')
  })

  it('renders an em-dash and "Нет данных" label when value is null', () => {
    const wrapper = mount(RingGauge, { props: { value: null } })
    expect(wrapper.find('.ring').text()).toContain('—')
    expect(wrapper.get('.ring').attributes('aria-label')).toBe('Нет данных')
  })
})
