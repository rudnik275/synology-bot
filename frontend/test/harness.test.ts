// Proves the frontend component-test harness works end-to-end under `bun test`:
// the .vue SFC loader (frontend/test-setup.ts) compiles a real SFC, happy-dom
// provides the DOM, and @vue/test-utils mounts + drives it. Every Vue slice
// (#60, #61, #64, #70, #71) relies on this harness for its component tests.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import ExampleCounter from './ExampleCounter.vue'

describe('frontend component test harness', () => {
  it('mounts an SFC and renders props', () => {
    const wrapper = mount(ExampleCounter, { props: { label: 'hello' } })
    expect(wrapper.find('.label').text()).toBe('hello')
  })

  it('reacts to a click', async () => {
    const wrapper = mount(ExampleCounter, { props: { label: 'hello' } })
    expect(wrapper.get('button').text()).toBe('count is 0')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').text()).toBe('count is 1')
  })
})
