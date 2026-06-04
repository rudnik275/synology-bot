// Unit tests for useTgBackButton (#177): the shared Telegram BackButton wiring
// duplicated between AddFlow.vue and ShowsTab.vue. Stubs
// window.Telegram.WebApp.BackButton and asserts show/hide/onClick/offClick.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { useTgBackButton } from '../src/composables/useTgBackButton'

type BackButtonStub = {
  show: () => void
  hide: () => void
  onClick: (cb: () => void) => void
  offClick: (cb: () => void) => void
  shows: number
  hides: number
  handlers: Array<() => void>
  removed: Array<() => void>
}

function installBackButton(): BackButtonStub {
  const stub: BackButtonStub = {
    shows: 0,
    hides: 0,
    handlers: [],
    removed: [],
    show() { this.shows++ },
    hide() { this.hides++ },
    onClick(cb: () => void) { this.handlers.push(cb) },
    offClick(cb: () => void) { this.removed.push(cb) },
  }
  ;(window as unknown as { Telegram?: unknown }).Telegram = { WebApp: { BackButton: stub } }
  return stub
}

afterEach(() => {
  ;(window as unknown as { Telegram?: unknown }).Telegram = undefined
})

describe('useTgBackButton', () => {
  it('show() shows the native button and registers the handler', () => {
    const stub = installBackButton()
    const handler = () => {}
    const { show } = useTgBackButton(handler)
    show()
    expect(stub.shows).toBe(1)
    expect(stub.handlers).toContain(handler)
  })

  it('the registered handler is the one passed in (invoking it calls back)', () => {
    const stub = installBackButton()
    let called = 0
    const { show } = useTgBackButton(() => { called++ })
    show()
    stub.handlers[0]!()
    expect(called).toBe(1)
  })

  it('hide() hides the native button and unregisters the handler', () => {
    const stub = installBackButton()
    const handler = () => {}
    const { show, hide } = useTgBackButton(handler)
    show()
    hide()
    expect(stub.hides).toBe(1)
    expect(stub.removed).toContain(handler)
  })

  it('is a no-op (does not throw) when BackButton is unavailable', () => {
    ;(window as unknown as { Telegram?: unknown }).Telegram = undefined
    const { show, hide } = useTgBackButton(() => {})
    expect(() => { show(); hide() }).not.toThrow()
  })

  it('is a no-op when Telegram exists but BackButton is absent', () => {
    ;(window as unknown as { Telegram?: unknown }).Telegram = { WebApp: {} }
    const { show, hide } = useTgBackButton(() => {})
    expect(() => { show(); hide() }).not.toThrow()
  })
})
