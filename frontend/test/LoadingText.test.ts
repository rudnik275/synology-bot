// Tests for the LoadingText primitive (Theme 1 sub-issue e, #176).
// Written test-first (TDD red phase); LoadingText.vue must not exist yet when added.
//
// LoadingText is a dumb presentational composite:
//   - renders a Spinner + a label
//   - default label text is "Загрузка…" (Russian — user-facing strings stay Russian)
//   - `label` prop overrides the default text
//   - `size` prop threads through to the inner Spinner (default 16)
//   - $attrs fall-through to the root element
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import LoadingText from '../src/components/ui/LoadingText.vue'

describe('LoadingText', () => {
  it('renders a root element with class "loading-text"', () => {
    const wrapper = mount(LoadingText)
    expect(wrapper.find('.loading-text').exists()).toBe(true)
  })

  it('shows the default label "Загрузка…"', () => {
    const wrapper = mount(LoadingText)
    expect(wrapper.text()).toContain('Загрузка…')
  })

  it('shows a custom label when the label prop is passed', () => {
    const wrapper = mount(LoadingText, { props: { label: 'Поиск…' } })
    expect(wrapper.text()).toContain('Поиск…')
    expect(wrapper.text()).not.toContain('Загрузка…')
  })

  it('contains an inner Spinner element', () => {
    const wrapper = mount(LoadingText)
    // The inner Spinner renders a .spinner element
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })

  it('threads the size prop to the inner Spinner', () => {
    const wrapper = mount(LoadingText, { props: { size: 18 } })
    const spinnerEl = wrapper.get('.spinner')
    const style = spinnerEl.attributes('style') ?? ''
    expect(style).toContain('width: 18px')
    expect(style).toContain('height: 18px')
  })

  it('falls through attrs to the root element', () => {
    const wrapper = mount(LoadingText, {
      attrs: { 'data-testid': 'loading-indicator' },
    })
    const el = wrapper.get('.loading-text')
    expect(el.attributes('data-testid')).toBe('loading-indicator')
  })

  it('merges extra class onto the root element', () => {
    const wrapper = mount(LoadingText, { attrs: { class: 'extra' } })
    expect(wrapper.get('.loading-text').classes()).toContain('extra')
  })
})
