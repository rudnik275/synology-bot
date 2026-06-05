// TDD for ShowDetail.vue redesign (#254).
// Tests are written BEFORE the implementation changes (RED phase).
//
// Four behaviors:
//   (a) Description renders inline — NOT inside a <details> element
//   (b) Description section appears before the seasons section in DOM order
//   (c) Poster uses hero class/structure (not the old 60×90 thumbnail)
//   (d) Existing status/subscribe testids still resolve after redesign

import { describe, it, expect } from 'bun:test'
import { mount, flushPromises } from '@vue/test-utils'
import ShowDetail from '../src/components/ShowDetail.vue'
import type { ShowDetailView } from '../src/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOW_WITH_DESCRIPTION: ShowDetailView = {
  id: 42,
  title: 'Breaking Bad',
  titleOriginal: 'Breaking Bad',
  poster: null,
  description: 'A chemistry teacher turned drug lord.',
  isSubscribed: true,
  seasons: [
    {
      season: 1,
      episodes: [
        { episode: 1, title: 'Pilot', airDate: '2008-01-20T02:00:00Z', aired: true },
        { episode: 2, title: "Cat's in the Bag", airDate: '2008-01-27T02:00:00Z', aired: true },
      ],
    },
  ],
}

const SHOW_NO_DESCRIPTION: ShowDetailView = {
  ...SHOW_WITH_DESCRIPTION,
  description: null,
}

const SHOW_NOT_SUBSCRIBED: ShowDetailView = {
  ...SHOW_WITH_DESCRIPTION,
  isSubscribed: false,
}

// ---------------------------------------------------------------------------
// (a) Description renders inline — NOT inside a <details> element
// ---------------------------------------------------------------------------

describe('ShowDetail — description is inline, not a dropdown', () => {
  it('description text is visible directly in the DOM', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    expect(wrapper.text()).toContain('A chemistry teacher turned drug lord.')
  })

  it('description is NOT wrapped in a <details> element', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('description text is inside a <p class="show-description"> element', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    const p = wrapper.find('p.show-description')
    expect(p.exists()).toBe(true)
    expect(p.text()).toContain('A chemistry teacher turned drug lord.')
  })

  it('description section is not rendered when show.description is null', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_NO_DESCRIPTION } })
    await flushPromises()

    expect(wrapper.find('p.show-description').exists()).toBe(false)
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('description section has a visible label ("Описание")', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    // The section label must be present in the DOM
    expect(wrapper.text()).toContain('Описание')
  })
})

// ---------------------------------------------------------------------------
// (b) Description appears BEFORE the seasons section in DOM order
// ---------------------------------------------------------------------------

describe('ShowDetail — content-first order: description before seasons', () => {
  it('description <p> comes before the seasons section in the DOM', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    const root = wrapper.element
    const allElements = Array.from(root.querySelectorAll('*'))

    const descriptionEl = root.querySelector('p.show-description')
    // The seasons section is rendered by SeasonAccordion — find it by a known
    // structural marker: the "Сезоны" heading or the seasons-section container.
    const seasonsSectionEl = root.querySelector('.seasons-section')

    expect(descriptionEl).not.toBeNull()
    expect(seasonsSectionEl).not.toBeNull()

    // Compare DOM order: description must appear before the seasons section.
    // Node.DOCUMENT_POSITION_FOLLOWING means descriptionEl is before seasonsSectionEl.
    const position = descriptionEl!.compareDocumentPosition(seasonsSectionEl!)
    // DOCUMENT_POSITION_FOLLOWING = 4 means seasonsSectionEl follows descriptionEl
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('status-row comes before description in DOM order', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    const root = wrapper.element
    const statusRowEl = root.querySelector('.status-row')
    const descriptionEl = root.querySelector('p.show-description')

    expect(statusRowEl).not.toBeNull()
    expect(descriptionEl).not.toBeNull()

    // statusRow must come before description
    const position = statusRowEl!.compareDocumentPosition(descriptionEl!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// (c) Poster uses hero class/structure (bigger than the old 60×90 thumbnail)
// ---------------------------------------------------------------------------

describe('ShowDetail — poster is hero-sized', () => {
  it('poster element has class show-thumb', async () => {
    const wrapper = mount(ShowDetail, {
      props: {
        show: { ...SHOW_WITH_DESCRIPTION, poster: 'https://example.com/poster.jpg' },
      },
    })
    await flushPromises()

    const thumb = wrapper.find('.show-thumb')
    expect(thumb.exists()).toBe(true)
  })

  it('placeholder also has class show-thumb when no poster URL', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    // No poster → placeholder div
    const thumb = wrapper.find('.show-thumb')
    expect(thumb.exists()).toBe(true)
  })

  it('poster img has the correct alt attribute', async () => {
    const wrapper = mount(ShowDetail, {
      props: {
        show: { ...SHOW_WITH_DESCRIPTION, poster: 'https://example.com/poster.jpg' },
      },
    })
    await flushPromises()

    const img = wrapper.find('img.show-thumb')
    expect(img.exists()).toBe(true)
    expect(img.attributes('alt')).toBe('Breaking Bad')
  })

  it('show-thumb is inside .show-hero (hero layout)', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    const hero = wrapper.find('.show-hero')
    expect(hero.exists()).toBe(true)
    const thumb = hero.find('.show-thumb')
    expect(thumb.exists()).toBe(true)
  })

  it('show-title uses fs-lg class or is inside show-hero (upscaled)', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()

    // The title must be present in the hero
    const hero = wrapper.find('.show-hero')
    expect(hero.exists()).toBe(true)
    const title = hero.find('.show-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe('Breaking Bad')
  })

  it('skeleton uses sk-thumb class inside show-hero', async () => {
    const wrapper = mount(ShowDetail, { props: { loading: true } })
    await flushPromises()

    const skThumb = wrapper.find('.sk-thumb')
    expect(skThumb.exists()).toBe(true)
    // Must be inside .show-hero
    const hero = wrapper.find('.show-hero')
    expect(hero.find('.sk-thumb').exists()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (d) Existing status/subscribe testids still resolve after redesign
// ---------------------------------------------------------------------------

describe('ShowDetail — existing testids still work', () => {
  it('renders last-aired-code testid', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    // S01E02 is the last aired episode
    expect(wrapper.find('[data-testid="last-aired-code"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="last-aired-code"]').text()).toBe('S01E02')
  })

  it('renders last-aired-date testid', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    expect(wrapper.find('[data-testid="last-aired-date"]').exists()).toBe(true)
  })

  it('renders next-episode-empty when no unaired episodes', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    // All episodes are aired — no next episode
    expect(wrapper.find('[data-testid="next-episode-empty"]').exists()).toBe(true)
  })

  it('renders unsubscribe-btn for subscribed show', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    expect(wrapper.find('[data-testid="unsubscribe-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subscribe-btn"]').exists()).toBe(false)
  })

  it('renders subscribe-btn for non-subscribed show', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_NOT_SUBSCRIBED } })
    await flushPromises()
    expect(wrapper.find('[data-testid="subscribe-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="unsubscribe-btn"]').exists()).toBe(false)
  })

  it('subscribe emit fires on subscribe-btn click', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_NOT_SUBSCRIBED } })
    await flushPromises()
    await wrapper.find('[data-testid="subscribe-btn"]').trigger('click')
    expect(wrapper.emitted('subscribe')).toHaveLength(1)
  })

  it('unsubscribe emit fires on unsubscribe-btn click', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    await wrapper.find('[data-testid="unsubscribe-btn"]').trigger('click')
    expect(wrapper.emitted('unsubscribe')).toHaveLength(1)
  })

  it('shows the show title', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    expect(wrapper.text()).toContain('Breaking Bad')
  })

  it('shows the original title when present', async () => {
    const wrapper = mount(ShowDetail, { props: { show: SHOW_WITH_DESCRIPTION } })
    await flushPromises()
    expect(wrapper.find('.show-title-original').exists()).toBe(true)
  })

  it('shows loading skeleton when loading=true and show=null', async () => {
    const wrapper = mount(ShowDetail, { props: { loading: true } })
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })
})
