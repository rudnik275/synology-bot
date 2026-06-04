// TDD test file for HealthChip.vue (ADR 0006 ambient header chip, issue #182).
// Written before the implementation (red phase). The component does NOT exist yet.
//
// HealthChip is a dumb presentational component — it takes `status` and `metric`
// as props (App.vue wires them from useHealth) and emits `select` when tapped.
// Each status gets a distinct dot color AND a text/aria cue (color-not-only).
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import HealthChip from '../src/components/ui/HealthChip.vue'
import type { HealthStatus } from '../src/components/health'

// ─── helpers ─────────────────────────────────────────────────────────────────

function mk(status: HealthStatus, metric = 'vol 50%') {
  return mount(HealthChip, { props: { status, metric } })
}

// ─── structure & a11y ────────────────────────────────────────────────────────

describe('HealthChip — structure', () => {
  it('renders a root button element', () => {
    const wrapper = mk('ok')
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('shows the metric text', () => {
    const wrapper = mk('ok', 'volume1 72%')
    expect(wrapper.text()).toContain('volume1 72%')
  })

  it('falls through attrs (data-testid) to the root button', () => {
    const wrapper = mount(HealthChip, {
      props: { status: 'ok', metric: 'x' },
      attrs: { 'data-testid': 'health-chip' },
    })
    expect(wrapper.find('button').attributes('data-testid')).toBe('health-chip')
  })
})

// ─── dot color classes per status ────────────────────────────────────────────

describe('HealthChip — dot color', () => {
  it('applies dot--ok class for ok status', () => {
    const wrapper = mk('ok')
    expect(wrapper.find('.dot').classes()).toContain('dot--ok')
  })

  it('applies dot--warn class for warn status', () => {
    const wrapper = mk('warn')
    expect(wrapper.find('.dot').classes()).toContain('dot--warn')
  })

  it('applies dot--bad class for bad status', () => {
    const wrapper = mk('bad')
    expect(wrapper.find('.dot').classes()).toContain('dot--bad')
  })

  it('applies dot--idle class for unknown (idle) status', () => {
    const wrapper = mk('unknown')
    expect(wrapper.find('.dot').classes()).toContain('dot--idle')
  })
})

// ─── color-not-only: text/aria cue per status ────────────────────────────────
// ADR 0006: color alone is not sufficient for a11y — each status must carry a
// text or ARIA label cue so screen-readers and colorblind users can distinguish.

describe('HealthChip — color-not-only cues', () => {
  it('ok status has a text cue', () => {
    const wrapper = mk('ok')
    // Either visible text or aria-label must carry the status name
    const hasLabel = wrapper.attributes('aria-label') ?? ''
    const hasText = wrapper.text()
    expect(hasLabel.toLowerCase().includes('ok') || hasText.toLowerCase().includes('ok')).toBe(true)
  })

  it('warn status has a text cue', () => {
    const wrapper = mk('warn')
    const hasLabel = wrapper.attributes('aria-label') ?? ''
    const hasText = wrapper.text()
    expect(
      hasLabel.toLowerCase().includes('warn') ||
      hasText.toLowerCase().includes('warn') ||
      hasLabel.toLowerCase().includes('attention') ||
      hasText.toLowerCase().includes('attention'),
    ).toBe(true)
  })

  it('bad status has a text cue', () => {
    const wrapper = mk('bad')
    const hasLabel = wrapper.attributes('aria-label') ?? ''
    const hasText = wrapper.text()
    expect(
      hasLabel.toLowerCase().includes('bad') ||
      hasText.toLowerCase().includes('bad') ||
      hasLabel.toLowerCase().includes('critical') ||
      hasText.toLowerCase().includes('critical'),
    ).toBe(true)
  })

  it('unknown status has a text cue', () => {
    const wrapper = mk('unknown')
    const hasLabel = wrapper.attributes('aria-label') ?? ''
    const hasText = wrapper.text()
    expect(
      hasLabel.toLowerCase().includes('unknown') ||
      hasText.toLowerCase().includes('unknown') ||
      hasLabel.toLowerCase().includes('idle') ||
      hasText.toLowerCase().includes('idle') ||
      hasLabel.toLowerCase().includes('connecting') ||
      hasText.toLowerCase().includes('connecting'),
    ).toBe(true)
  })

  it('has an accessible button label', () => {
    const wrapper = mk('ok', 'vol 72%')
    const btn = wrapper.find('button')
    // button must have either aria-label or visible text that is not just the metric
    const label = btn.attributes('aria-label') ?? btn.text()
    expect(label.length).toBeGreaterThan(0)
  })
})

// ─── tap → select event ───────────────────────────────────────────────────────

describe('HealthChip — interaction', () => {
  it('emits "select" when the button is clicked', async () => {
    const wrapper = mk('ok')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('emits "select" for each status (ok/warn/bad/unknown)', async () => {
    for (const status of ['ok', 'warn', 'bad', 'unknown'] as HealthStatus[]) {
      const wrapper = mk(status)
      await wrapper.find('button').trigger('click')
      expect(wrapper.emitted('select')).toHaveLength(1)
    }
  })
})

// ─── idle / not-yet-wired state ───────────────────────────────────────────────

describe('HealthChip — idle state', () => {
  it('renders gracefully with unknown status (no crash)', () => {
    expect(() => mk('unknown')).not.toThrow()
  })

  it('still shows the metric text in idle state', () => {
    const wrapper = mk('unknown', '—')
    expect(wrapper.text()).toContain('—')
  })
})
