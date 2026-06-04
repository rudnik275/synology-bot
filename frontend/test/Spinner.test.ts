// Tests for the Spinner primitive (Theme 1 sub-issue e, #176).
// Written test-first (TDD red phase); Spinner.vue must not exist yet when added.
//
// Spinner is a dumb presentational primitive:
//   - a circular activity indicator (ring + arc)
//   - `size` prop in px (default 16)
//   - $attrs fall-through to the root element
//   - under reduced-motion the CSS rule already handles the animation
//     (tokens.css @media prefers-reduced-motion zeros animation-duration)
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import Spinner from '../src/components/ui/Spinner.vue'

describe('Spinner', () => {
  it('renders a root element with class "spinner"', () => {
    const wrapper = mount(Spinner)
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })

  it('defaults to size 16 (width and height inline styles)', () => {
    const wrapper = mount(Spinner)
    const el = wrapper.get('.spinner')
    const style = el.attributes('style') ?? ''
    expect(style).toContain('width: 16px')
    expect(style).toContain('height: 16px')
  })

  it('applies the size prop as inline width/height', () => {
    const wrapper = mount(Spinner, { props: { size: 24 } })
    const el = wrapper.get('.spinner')
    const style = el.attributes('style') ?? ''
    expect(style).toContain('width: 24px')
    expect(style).toContain('height: 24px')
  })

  it('falls through attrs (aria-hidden, data-testid) to the root element', () => {
    const wrapper = mount(Spinner, {
      attrs: { 'aria-hidden': 'true', 'data-testid': 'my-spinner' },
    })
    const el = wrapper.get('.spinner')
    expect(el.attributes('aria-hidden')).toBe('true')
    expect(el.attributes('data-testid')).toBe('my-spinner')
  })

  it('merges extra class onto the root element', () => {
    const wrapper = mount(Spinner, { attrs: { class: 'extra-class' } })
    expect(wrapper.get('.spinner').classes()).toContain('extra-class')
  })
})
