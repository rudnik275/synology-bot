// Tests for Skeleton primitive (Theme 1 sub-issue g, #176).
//
// Skeleton is a dumb shimmer placeholder: a block element with the sk-shimmer
// animation using --sk-base/--sk-sheen/--sk-edge tokens. Size/shape are purely
// via $attrs (style/class fall-through) from the call-site; no layout props.
//
// Styles are not rendered by the test harness, so we assert structure/attrs only.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import Skeleton from '../src/components/ui/Skeleton.vue'

describe('Skeleton', () => {
  it('renders a single root element with the skeleton class', () => {
    const wrapper = mount(Skeleton)
    // Root element exists and has the marker class
    expect(wrapper.find('.skeleton').exists()).toBe(true)
  })

  it('falls through attrs — class and style are forwarded to the root element', () => {
    const wrapper = mount(Skeleton, {
      attrs: { style: 'width:62%; height:16px;', class: 'sk-title' },
    })
    const el = wrapper.find('.skeleton')
    expect(el.exists()).toBe(true)
    // $attrs class fall-through adds sk-title alongside .skeleton
    expect(el.classes()).toContain('sk-title')
    // Browser normalises style: spaces around colons; use includes with flexible match
    const style = el.attributes('style') ?? ''
    expect(style).toMatch(/width:\s*62%/)
    expect(style).toMatch(/height:\s*16px/)
  })

  it('renders a role="presentation" for a11y (it is decorative)', () => {
    const wrapper = mount(Skeleton)
    expect(wrapper.find('[role="presentation"]').exists()).toBe(true)
  })

  it('can be stacked as siblings — each instance is independent', () => {
    const parent = mount({
      template: `<div><Skeleton style="width:60%" /><Skeleton style="width:34px" /></div>`,
      components: { Skeleton },
    })
    const skeletons = parent.findAll('.skeleton')
    expect(skeletons).toHaveLength(2)
  })
})
