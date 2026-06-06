// Tests for SearchBar.vue — the shared segmented search control (icon + bare
// input + coral «Поиск» submit) used by both the add-flow search step and the
// Shows tab. Structure/behaviour is verified at the DOM level; layout-critical
// CSS is asserted against the SFC source text (happy-dom drops <style>).
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { join } from 'path'
import SearchBar from '../src/components/ui/SearchBar.vue'

// ── SFC source for CSS assertions ───────────────────────────────────────────
const SFC_PATH = join(import.meta.dir, '../src/components/ui/SearchBar.vue')
const sfcSource = readFileSync(SFC_PATH, 'utf-8')

function extractStyle(): string {
  const match = sfcSource.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return match ? match[1] : ''
}
const cssSource = extractStyle()

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('SearchBar — structure', () => {
  it('wraps a bare input and the submit button in ONE .nb-framed .search-frame', () => {
    const wrapper = mount(SearchBar, { props: { modelValue: '' } })
    const frame = wrapper.find('.search-frame')
    expect(frame.exists()).toBe(true)
    expect(frame.classes()).toContain('nb-framed')
    // Input + submit both live inside the single frame.
    expect(frame.find('input').exists()).toBe(true)
    expect(frame.find('[data-testid="search-btn"]').exists()).toBe(true)
    // The input is the bare variant (frame owns the chrome).
    expect(frame.find('input').classes()).toContain('search-field-input--bare')
  })

  it('falls input attrs (data-testid, placeholder) through to the inner input', () => {
    const wrapper = mount(SearchBar, {
      props: { modelValue: '' },
      attrs: { 'data-testid': 'search-query', placeholder: 'Введите…', inputmode: 'search' },
    })
    const input = wrapper.find('[data-testid="search-query"]')
    expect(input.exists()).toBe(true)
    expect(input.element.tagName).toBe('INPUT')
    expect(input.attributes('placeholder')).toBe('Введите…')
    expect(input.attributes('inputmode')).toBe('search')
  })

  it('renders the default «Поиск» label and a custom label', () => {
    const def = mount(SearchBar, { props: { modelValue: '' } })
    expect(def.find('[data-testid="search-btn"]').text()).toBe('Поиск')
    const custom = mount(SearchBar, { props: { modelValue: '', label: 'Найти' } })
    expect(custom.find('[data-testid="search-btn"]').text()).toBe('Найти')
  })

  it('disables the submit and shows «…» while loading', () => {
    const wrapper = mount(SearchBar, { props: { modelValue: '', loading: true } })
    const btn = wrapper.find('[data-testid="search-btn"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toBe('…')
  })

  it('squares the frame bottom (.search-frame--open) when open, for the flush combobox', () => {
    const closed = mount(SearchBar, { props: { modelValue: '' } })
    expect(closed.find('.search-frame').classes()).not.toContain('search-frame--open')
    const open = mount(SearchBar, { props: { modelValue: '', open: true } })
    expect(open.find('.search-frame').classes()).toContain('search-frame--open')
  })

  it('renders a #dropdown slot as a SIBLING of the clipped frame (not inside it)', () => {
    const wrapper = mount(SearchBar, {
      props: { modelValue: '' },
      slots: { dropdown: '<div data-testid="dd">recent</div>' },
    })
    // Inside the relative .search-bar anchor…
    expect(wrapper.find('.search-bar [data-testid="dd"]').exists()).toBe(true)
    // …but NOT inside the clipped .nb-framed frame (would be cut off).
    expect(wrapper.find('.search-frame [data-testid="dd"]').exists()).toBe(false)
  })
})

describe('SearchBar — events & v-model', () => {
  it('emits search on submit click and on Enter in the input', async () => {
    const wrapper = mount(SearchBar, { props: { modelValue: '' } })
    await wrapper.find('[data-testid="search-btn"]').trigger('click')
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('search')?.length).toBe(2)
  })

  it('emits focus and blur from the input', async () => {
    const wrapper = mount(SearchBar, { props: { modelValue: '' } })
    await wrapper.find('input').trigger('focus')
    await wrapper.find('input').trigger('blur')
    expect(wrapper.emitted('focus')?.length).toBe(1)
    expect(wrapper.emitted('blur')?.length).toBe(1)
  })

  it('updates the model when the user types', async () => {
    const wrapper = mount(SearchBar, { props: { modelValue: '' } })
    await wrapper.find('input').setValue('breaking bad')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['breaking bad'])
  })
})

describe('SearchBar — CSS (layout-critical)', () => {
  it('the submit segment is a coral fill', () => {
    const ruleMatch = cssSource.match(/\.search-submit\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    expect(normalise(ruleMatch![1])).toContain('background: var(--coral)')
  })

  it('.search-row-field grows to fill (flex:1) and can shrink (min-width:0)', () => {
    const ruleMatch = cssSource.match(/\.search-row-field\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('flex: 1')
    expect(decls).toContain('min-width: 0')
  })

  it('the open state squares the frame bottom corners (flush list below)', () => {
    // Match the combined .search-frame--open[, .search-frame--open:focus-within] rule.
    const ruleMatch = cssSource.match(/\.search-frame--open[^{]*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('border-bottom-left-radius: 0')
    expect(decls).toContain('border-bottom-right-radius: 0')
  })
})
