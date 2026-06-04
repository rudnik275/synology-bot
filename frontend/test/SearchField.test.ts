// Tests for the SearchField primitive (Theme 1 sub-issue d, #176).
// Written test-first (TDD red phase); SearchField.vue must not exist yet when added.
//
// SearchField is a dumb presentational input primitive:
//   - paper + border-strong + shadow + focus ring recipe
//   - v-model (modelValue + update:modelValue)
//   - $attrs fall-through (placeholder, data-testid, aria-*, inputmode, enterkeyhint, type)
//   - emits: @focus, @blur, @search (on Enter keydown)
//   - default slot for overlaying content (e.g. history dropdown)
//   - NO baked-in focus/blur logic — consumers wire their own behavior via events
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import SearchField from '../src/components/ui/SearchField.vue'

describe('SearchField', () => {
  it('renders a native input element', () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('sets the input value to modelValue', () => {
    const wrapper = mount(SearchField, { props: { modelValue: 'hello' } })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('hello')
  })

  it('emits update:modelValue when the input value changes', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } })
    await wrapper.find('input').setValue('test')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeDefined()
    expect(emitted![emitted!.length - 1]).toEqual(['test'])
  })

  it('emits @focus when the input receives focus', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } })
    await wrapper.find('input').trigger('focus')
    expect(wrapper.emitted('focus')).toHaveLength(1)
  })

  it('emits @blur when the input loses focus', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })

  it('emits @search on Enter keydown', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: 'query' } })
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('search')).toHaveLength(1)
  })

  it('falls through attrs (placeholder, data-testid) to the native input', () => {
    const wrapper = mount(SearchField, {
      props: { modelValue: '' },
      attrs: { placeholder: 'Поиск…', 'data-testid': 'my-search' },
    })
    const input = wrapper.find('input')
    expect(input.attributes('placeholder')).toBe('Поиск…')
    expect(input.attributes('data-testid')).toBe('my-search')
  })

  it('falls through inputmode and enterkeyhint to the native input', () => {
    const wrapper = mount(SearchField, {
      props: { modelValue: '' },
      attrs: { inputmode: 'search', enterkeyhint: 'search' },
    })
    const input = wrapper.find('input')
    expect(input.attributes('inputmode')).toBe('search')
    expect(input.attributes('enterkeyhint')).toBe('search')
  })

  it('renders default slot content alongside the input', () => {
    const wrapper = mount(SearchField, {
      props: { modelValue: '' },
      slots: { default: '<div data-testid="dropdown">Dropdown</div>' },
    })
    expect(wrapper.find('[data-testid="dropdown"]').exists()).toBe(true)
  })

  it('has a root container element wrapping the input and slot', () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } })
    // Root should be a container div (not bare input) so slot content can be positioned
    expect(wrapper.find('input').exists()).toBe(true)
    // The component root is not the input itself
    expect(wrapper.element.tagName).not.toBe('INPUT')
  })
})
