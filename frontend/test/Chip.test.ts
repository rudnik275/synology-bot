// Tests for the Chip primitive (Theme 1 sub-issue c, #176).
// Written test-first (TDD red phase); Chip.vue must not exist yet when added.
//
// Chip is a dumb presentational primitive with three visual variants:
//   flat     — solid ink-chip-bg pill (AddFlow confirm quality chips)
//   outlined — bordered pill, paper bg (AddFlow search result-chip)
//   tag      — cream bg + thin border + square-ish radius + opacity
//              (DownloadsTab quality chips under task title)
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import Chip from '../src/components/ui/Chip.vue'

describe('Chip', () => {
  it('renders slot content inside a span with class "chip"', () => {
    const wrapper = mount(Chip, { slots: { default: '1080p' } })
    const el = wrapper.get('span.chip')
    expect(el.text()).toBe('1080p')
  })

  it('defaults to the "flat" variant', () => {
    const wrapper = mount(Chip, { slots: { default: 'BluRay' } })
    expect(wrapper.get('span').classes()).toContain('v-flat')
  })

  it('applies the v-flat class for the flat variant', () => {
    const wrapper = mount(Chip, { props: { variant: 'flat' }, slots: { default: 'x264' } })
    expect(wrapper.get('span').classes()).toContain('v-flat')
    expect(wrapper.get('span').classes()).not.toContain('v-outlined')
    expect(wrapper.get('span').classes()).not.toContain('v-tag')
  })

  it('applies the v-outlined class for the outlined variant', () => {
    const wrapper = mount(Chip, { props: { variant: 'outlined' }, slots: { default: 'HD' } })
    expect(wrapper.get('span').classes()).toContain('v-outlined')
    expect(wrapper.get('span').classes()).not.toContain('v-flat')
    expect(wrapper.get('span').classes()).not.toContain('v-tag')
  })

  it('applies the v-tag class for the tag variant', () => {
    const wrapper = mount(Chip, { props: { variant: 'tag' }, slots: { default: '2008' } })
    expect(wrapper.get('span').classes()).toContain('v-tag')
    expect(wrapper.get('span').classes()).not.toContain('v-flat')
    expect(wrapper.get('span').classes()).not.toContain('v-outlined')
  })

  it('falls through attrs (data-testid, extra class) to the root span', () => {
    const wrapper = mount(Chip, {
      props: { variant: 'outlined' },
      attrs: { 'data-testid': 'result-quality', class: 'extra' },
      slots: { default: 'HDR' },
    })
    const span = wrapper.get('span')
    expect(span.attributes('data-testid')).toBe('result-quality')
    // extra class merges onto the root
    expect(span.classes()).toContain('extra')
  })

  it('renders empty when no slot content', () => {
    const wrapper = mount(Chip, { props: { variant: 'flat' } })
    expect(wrapper.get('span.chip').text()).toBe('')
  })
})
