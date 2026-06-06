// Tests for AddSearchStep.vue layout fixes (#247).
//
// Three CSS/layout fixes are covered:
//   #10 — full-width input: .search-row-field must have flex:1 + min-width:0
//   #11 — no vestigial border: no stray border-bottom on the sticky row or field wrapper
//   #12 — inner scroll: .search-results owns the scroll; .step-input + .search-field
//          are flex columns with min-height:0 so the results region can flex-grow
//
// NOTE: The bun:test + @vue/test-utils harness intentionally drops <style> blocks
// (CSS is not applied in happy-dom unit tests). DOM-level assertions therefore verify
// element structure and class application. Layout-critical CSS declarations are
// verified directly against the SFC source text, which is a reliable regression guard
// for CSS-only changes.
import { describe, it, expect } from 'bun:test'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { join } from 'path'
import AddSearchStep from '../src/components/AddSearchStep.vue'
import type { SearchResultView } from '../src/types'

// ── SFC source for CSS assertions ───────────────────────────────────────────
const SFC_PATH = join(import.meta.dir, '../src/components/AddSearchStep.vue')
const sfcSource = readFileSync(SFC_PATH, 'utf-8')

/** Extract the raw text of the <style> block from the SFC source. */
function extractStyle(): string {
  const match = sfcSource.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return match ? match[1] : ''
}

const cssSource = extractStyle()

/** Normalise whitespace in a CSS block to make rule matching robust. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ── Minimal props for mounting ───────────────────────────────────────────────
const baseProps = {
  searchLoading: false,
  searchError: null,
  searchQueried: false,
  searchResults: [] as SearchResultView[],
  searchHistoryVisible: false,
  filteredHistory: [] as string[],
  searchHistory: [] as string[],
}

const SAMPLE_RESULTS: SearchResultView[] = [
  {
    id: 'r1',
    title: 'Movie One',
    size: '2.1 GB',
    seeders: 10,
    leechers: 2,
    downloadUrl: 'https://example.com/r1.torrent',
    category: 'movies',
    quality: ['1080p'],
  },
]

// ── #10: Full-width input ────────────────────────────────────────────────────

describe('#10 full-width input', () => {
  it('search-row-field class is applied to the SearchField inside .search-row', () => {
    const wrapper = mount(AddSearchStep, {
      props: { ...baseProps, searchQuery: '' },
    })
    // The class is the hook that CSS attaches flex:1 + min-width:0 to.
    const field = wrapper.find('.search-row .search-row-field')
    expect(field.exists()).toBe(true)
  })

  it('CSS: .search-row-field has flex:1', () => {
    // Ensures the input region grows to fill available width.
    expect(normalise(cssSource)).toContain('.search-row-field')
    const ruleMatch = cssSource.match(/\.search-row-field\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('flex: 1')
  })

  it('CSS: .search-row-field has min-width:0 to prevent flex overflow', () => {
    // Without min-width:0 the flex child cannot shrink below its intrinsic width,
    // which causes the input to overflow on narrow screens.
    const ruleMatch = cssSource.match(/\.search-row-field\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('min-width: 0')
  })

  it('SearchField has no inline max-width or fixed-width style that would limit it', () => {
    const wrapper = mount(AddSearchStep, {
      props: { ...baseProps, searchQuery: '' },
    })
    const field = wrapper.find('.search-row-field')
    expect(field.exists()).toBe(true)
    const style = (field.element as HTMLElement).getAttribute('style') ?? ''
    expect(style).not.toContain('max-width')
    expect(style).not.toContain('width:')
    expect(style).not.toContain('width :')
  })
})

// ── #11: No vestigial border ─────────────────────────────────────────────────

describe('#11 no vestigial border on sticky search row or field wrapper', () => {
  it('CSS: .search-row has no border-bottom declaration (vestigial artifact)', () => {
    // The sticky search row should not have a bottom border — it pins at the top
    // of the scroll region and acts as a visual separator by z-index, not a line.
    const ruleMatch = cssSource.match(/\.search-row\s*\{([^}]*)\}/)
    if (!ruleMatch) {
      // No .search-row rule at all is also fine.
      expect(ruleMatch).toBeNull()
      return
    }
    const decls = normalise(ruleMatch[1])
    expect(decls).not.toContain('border-bottom')
  })

  it('CSS: .search-field wrapper has no border-bottom (only .search-results has the outer border)', () => {
    // .search-results carries the intentional outer border; .search-field should not
    // duplicate it with a stray border-bottom that would double-up visually.
    const ruleMatch = cssSource.match(/\.search-field\s*\{([^}]*)\}/)
    if (!ruleMatch) {
      expect(ruleMatch).toBeNull()
      return
    }
    const decls = normalise(ruleMatch[1])
    expect(decls).not.toContain('border-bottom')
  })

  it('CSS: intentional .result-row border-bottom (row dividers) is preserved', () => {
    // Hairline dividers between result rows MUST remain. This guards against
    // accidentally removing the wrong border.
    expect(normalise(cssSource)).toContain('.result-row')
    const ruleMatch = cssSource.match(/\.result-row\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('border-bottom')
  })

  it('CSS: intentional .search-results outer border is preserved', () => {
    // The outer "grouped card" border on .search-results must remain.
    const ruleMatch = cssSource.match(/\.search-results\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('border')
  })
})

// ── #12: Inner scroll — results list scrolls, not the page ──────────────────

describe('#12 inner scroll: results container owns the scroll region', () => {
  it('CSS: .step-input is a flex column with min-height:0', () => {
    // Without min-height:0 the flex parent cannot be constrained below its
    // natural content height, so inner overflow-y:auto never engages.
    const ruleMatch = cssSource.match(/\.step-input\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('display: flex')
    expect(decls).toContain('flex-direction: column')
    expect(decls).toContain('min-height: 0')
  })

  it('CSS: .search-field is a flex column with min-height:0 and flex:1', () => {
    // .search-field must participate in the flex chain — flex:1 lets it grow to
    // fill .step-input, and min-height:0 allows it to be constrained so the inner
    // .search-results overflow-y:auto actually scrolls rather than growing the page.
    const ruleMatch = cssSource.match(/\.search-field\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('display: flex')
    expect(decls).toContain('flex-direction: column')
    expect(decls).toContain('min-height: 0')
    expect(decls).toContain('flex: 1')
  })

  it('CSS: .search-results has overflow set to enable inner scrolling', () => {
    // This is the actual scroll region. overflow-y:auto (or "hidden auto") must
    // be present so the list scrolls independently of the page.
    const ruleMatch = cssSource.match(/\.search-results\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    // Accept either overflow shorthand or overflow-y longhand.
    const hasOverflow = decls.includes('overflow:') ||
      decls.includes('overflow-y:') ||
      decls.includes('overflow: ') ||
      decls.includes('overflow-y: ')
    expect(hasOverflow).toBe(true)
  })

  it('.search-results element is present in the DOM when results are provided', () => {
    // Structural guard: the scroll container element must exist in the rendered DOM.
    const wrapper = mount(AddSearchStep, {
      props: {
        ...baseProps,
        searchResults: SAMPLE_RESULTS,
        searchQuery: 'Movie',
      },
    })
    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="search-results"]').attributes('role')).toBe('list')
  })

  it('.search-row is inside .step-input (sticky header contained within the flex column)', () => {
    const wrapper = mount(AddSearchStep, {
      props: { ...baseProps, searchQuery: '' },
    })
    // The sticky search bar must be a descendant of the constrained flex column
    // so z-index:10 pins it above the scrolling results region below.
    expect(wrapper.find('.step-input .search-row').exists()).toBe(true)
  })

  it('CSS: .search-row has position:sticky and z-index so it pins above the scroll region', () => {
    const ruleMatch = cssSource.match(/\.search-row\s*\{([^}]*)\}/)
    expect(ruleMatch).not.toBeNull()
    const decls = normalise(ruleMatch![1])
    expect(decls).toContain('position: sticky')
    expect(decls).toContain('z-index')
  })
})

// ── #268 task 04: history dropdown only opens when there are matching items ──
describe('#268 task 04 history dropdown', () => {
  it('does NOT render the dropdown when the filtered list is empty (even if history exists)', () => {
    // Previously it also opened on `searchHistory.length > 0`, drawing a
    // header-only, bordered empty dropdown on focus.
    const wrapper = mount(AddSearchStep, {
      props: {
        ...baseProps,
        searchQuery: 'zzz',
        searchHistoryVisible: true,
        filteredHistory: [],
        searchHistory: ['old query'],
      },
    })
    expect(wrapper.find('[data-testid="search-history"]').exists()).toBe(false)
  })

  it('renders the dropdown when there are filtered (matching) items', () => {
    const wrapper = mount(AddSearchStep, {
      props: {
        ...baseProps,
        searchQuery: '',
        searchHistoryVisible: true,
        filteredHistory: ['old query'],
        searchHistory: ['old query'],
      },
    })
    expect(wrapper.find('[data-testid="search-history"]').exists()).toBe(true)
  })
})

// ── #268 task 05: the loading state is a skeleton card, not a text loader ──
describe('#268 task 05 skeleton loader', () => {
  it('shows skeleton result rows while loading', () => {
    const wrapper = mount(AddSearchStep, {
      props: { ...baseProps, searchQuery: 'x', searchLoading: true },
    })
    const loading = wrapper.find('[data-testid="search-loading"]')
    expect(loading.exists()).toBe(true)
    expect(loading.findAll('.result-row--skeleton').length).toBeGreaterThanOrEqual(3)
  })
})
