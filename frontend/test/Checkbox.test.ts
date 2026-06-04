// Tests for the Checkbox primitive (Theme 1 sub-issue f, #176).
// Written test-first (TDD red phase); Checkbox.vue must not exist yet when added.
//
// Checkbox is a dumb Neo-Brutalism square checkbox primitive extracted from
// TreeNode.vue (the `.ck` block). It supports:
//   - checked / indeterminate / disabled states
//   - emits 'change' on click (when not disabled)
//   - $attrs fall-through for data-testid and extra classes
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import Checkbox from '../src/components/ui/Checkbox.vue'

describe('Checkbox', () => {
  it('renders a button with role="checkbox"', () => {
    const wrapper = mount(Checkbox, { props: { checked: false } })
    const btn = wrapper.get('button')
    expect(btn.attributes('role')).toBe('checkbox')
  })

  it('shows unchecked state — no checkmark svg, no dash', () => {
    const wrapper = mount(Checkbox, { props: { checked: false } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('.dash').exists()).toBe(false)
    expect(wrapper.get('button').attributes('aria-checked')).toBe('false')
  })

  it('shows checked state — checkmark svg present, aria-checked=true', () => {
    const wrapper = mount(Checkbox, { props: { checked: true } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.get('button').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('button').classes()).toContain('ck--on')
  })

  it('shows indeterminate state — dash span present, aria-checked="mixed"', () => {
    const wrapper = mount(Checkbox, { props: { checked: false, indeterminate: true } })
    expect(wrapper.find('.dash').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.get('button').attributes('aria-checked')).toBe('mixed')
    expect(wrapper.get('button').classes()).toContain('ck--some')
  })

  it('indeterminate + checked shows dash (indeterminate takes visual priority)', () => {
    const wrapper = mount(Checkbox, { props: { checked: true, indeterminate: true } })
    // indeterminate overrides checked display
    expect(wrapper.find('.dash').exists()).toBe(true)
    expect(wrapper.get('button').attributes('aria-checked')).toBe('mixed')
  })

  it('emits "change" with new value (true) when unchecked button is clicked', async () => {
    const wrapper = mount(Checkbox, { props: { checked: false } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('change')).toBeTruthy()
    expect(wrapper.emitted('change')![0]).toEqual([true])
  })

  it('emits "change" with new value (false) when checked button is clicked', async () => {
    const wrapper = mount(Checkbox, { props: { checked: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('change')).toBeTruthy()
    expect(wrapper.emitted('change')![0]).toEqual([false])
  })

  it('does not emit "change" when disabled', async () => {
    const wrapper = mount(Checkbox, { props: { checked: false, disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('change')).toBeFalsy()
  })

  it('applies disabled attribute to the button when disabled prop is true', () => {
    const wrapper = mount(Checkbox, { props: { checked: false, disabled: true } })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('falls through attrs (data-testid) to the root button', () => {
    const wrapper = mount(Checkbox, {
      props: { checked: false },
      attrs: { 'data-testid': 'tree-check-0' },
    })
    expect(wrapper.get('button').attributes('data-testid')).toBe('tree-check-0')
  })

  it('extra class in attrs merges onto the root button', () => {
    const wrapper = mount(Checkbox, {
      props: { checked: false },
      attrs: { class: 'extra-class' },
    })
    expect(wrapper.get('button').classes()).toContain('extra-class')
  })

  it('base ck class is always present on the button', () => {
    const wrapper = mount(Checkbox, { props: { checked: false } })
    expect(wrapper.get('button').classes()).toContain('ck')
  })
})
