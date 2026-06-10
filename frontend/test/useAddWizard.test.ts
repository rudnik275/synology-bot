// Unit tests for useAddWizard (#177): the add-flow step model + mode + the
// deep-link handoff, extracted from AddFlow.vue. A lightweight composable (NOT
// the GoF State pattern). Inspect/commit + search live elsewhere; the wizard
// takes those as injected deps so it stays testable in isolation.
import { describe, it, expect } from 'bun:test'
import { ref, nextTick } from 'vue'
import { useAddWizard, type WizardDeps } from '../src/composables/useAddWizard'
import type { SearchResultView } from '../src/types'

const RESULT: SearchResultView = {
  id: 'r1',
  title: 'Movie One',
  size: '2.1 GB',
  seeders: 10,
  leechers: 2,
  downloadUrl: 'https://example.com/movie1.torrent',
  category: 'movies',
}

type TrackedDeps = WizardDeps & { resetInspectCalls: number; cancelCalls: number }

function makeDeps(over: Partial<WizardDeps> = {}): TrackedDeps {
  const tracker = { resetInspectCalls: 0, cancelCalls: 0 }
  const deps = {
    lastFolder: ref(''),
    torrentStash: async () => ({ kind: 'uri', uri: 'magnet:?xt=urn:btih:x' }),
    resetInspect: () => { tracker.resetInspectCalls++ },
    cancelInspectIfOpen: () => { tracker.cancelCalls++ },
    ...over,
    // Live getters so reads reflect the closures' mutations, not a snapshot.
    get resetInspectCalls() { return tracker.resetInspectCalls },
    get cancelCalls() { return tracker.cancelCalls },
  } as TrackedDeps
  return deps
}

describe('useAddWizard — step model (in-app search path)', () => {
  it('starts at step 1 (Search) in search mode, not handoff', () => {
    const w = useAddWizard(makeDeps())
    expect(w.step.value).toBe(1)
    expect(w.mode.value).toBe('search')
    expect(w.handoff.value).toBe(false)
    expect(w.firstStep.value).toBe(1)
    expect(w.lastStep.value).toBe(3)
    expect(w.drawnSteps.value).toEqual([1, 2, 3])
  })

  it('canAdvance on step 1 gates on a selected search result', () => {
    const w = useAddWizard(makeDeps())
    expect(w.canAdvance.value).toBe(false)
    w.selectedResult.value = RESULT
    expect(w.canAdvance.value).toBe(true)
  })

  it('goNext does not advance while step 1 has no selection', () => {
    const w = useAddWizard(makeDeps())
    w.goNext()
    expect(w.step.value).toBe(1)
  })

  it('goNext advances 1→2 once a result is selected', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.goNext()
    expect(w.step.value).toBe(2)
  })

  it('canAdvance on step 2 gates on a non-empty destination', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.goNext() // → 2
    expect(w.canAdvance.value).toBe(false)
    w.destination.value = '/volume1/video'
    expect(w.canAdvance.value).toBe(true)
  })

  it('goNext advances 2→3 once a destination is set; Confirm always canAdvance', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.goNext() // → 2
    w.destination.value = '/volume1/video'
    w.goNext() // → 3
    expect(w.step.value).toBe(3)
    expect(w.canAdvance.value).toBe(true)
  })

  it('goNext does not advance past the last step (3)', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext(); w.goNext(); w.goNext()
    expect(w.step.value).toBe(3)
  })

  it('goBack walks 3→2→1 and stops at the first drawn step', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext(); w.goNext() // → 3
    w.goBack() // → 2
    expect(w.step.value).toBe(2)
    w.goBack() // → 1
    expect(w.step.value).toBe(1)
    w.goBack() // floor — stays
    expect(w.step.value).toBe(1)
  })

  it('leaving Confirm via goBack releases the inspect (cancel + reset)', () => {
    const deps = makeDeps()
    const w = useAddWizard(deps)
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext(); w.goNext() // → 3
    const cancelBefore = deps.cancelCalls
    const resetBefore = deps.resetInspectCalls
    w.goBack() // leaving Confirm
    expect(deps.cancelCalls).toBe(cancelBefore + 1)
    expect(deps.resetInspectCalls).toBe(resetBefore + 1)
  })
})

describe('useAddWizard — openSheet / resetForm', () => {
  it('openSheet opens, resets to step 1 search, and seeds destination from lastFolder', () => {
    const deps = makeDeps({ lastFolder: ref('/volume1/video') })
    const w = useAddWizard(deps)
    w.openSheet()
    expect(w.open.value).toBe(true)
    expect(w.step.value).toBe(1)
    expect(w.mode.value).toBe('search')
    expect(w.handoff.value).toBe(false)
    expect(w.destination.value).toBe('/volume1/video')
  })

  it('resetForm clears everything and calls resetInspect', () => {
    const deps = makeDeps()
    const w = useAddWizard(deps)
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.errorMsg.value = 'boom'
    w.handoff.value = true
    const before = deps.resetInspectCalls
    w.resetForm()
    expect(w.step.value).toBe(1)
    expect(w.mode.value).toBe('search')
    expect(w.handoff.value).toBe(false)
    expect(w.selectedResult.value).toBeNull()
    expect(w.selectedFile.value).toBeNull()
    expect(w.handoffUri.value).toBe('')
    expect(w.destination.value).toBe('')
    expect(w.errorMsg.value).toBeNull()
    expect(deps.resetInspectCalls).toBe(before + 1)
  })
})

describe('useAddWizard — bot handoff (deep link)', () => {
  it('uri stash: opens at Folder (step 2), mode uri, handoff true, Search undrawn', async () => {
    const deps = makeDeps({
      torrentStash: async () => ({ kind: 'uri', uri: 'magnet:?xt=urn:btih:abc' }),
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('TOK')
    await nextTick()
    expect(w.open.value).toBe(true)
    expect(w.handoff.value).toBe(true)
    expect(w.mode.value).toBe('uri')
    expect(w.handoffUri.value).toBe('magnet:?xt=urn:btih:abc')
    expect(w.step.value).toBe(2)
    expect(w.firstStep.value).toBe(2)
    expect(w.drawnSteps.value).toEqual([2, 3])
  })

  it('bytes stash: rebuilds a File via lib/base64 and opens at Folder in file mode', async () => {
    const deps = makeDeps({
      torrentStash: async () => ({ kind: 'bytes', name: 'F.torrent', base64: btoa('\x01\x02\x03') }),
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('TOK')
    expect(w.mode.value).toBe('file')
    expect(w.selectedFile.value).not.toBeNull()
    expect(w.selectedFile.value!.name).toBe('F.torrent')
    expect(w.step.value).toBe(2)
  })

  it('handoff seeds destination from lastFolder', async () => {
    const deps = makeDeps({
      lastFolder: ref('/volume1/video'),
      torrentStash: async () => ({ kind: 'uri', uri: 'magnet:?x' }),
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('TOK')
    expect(w.destination.value).toBe('/volume1/video')
  })

  it('on stash failure, recovers to the in-app search flow at step 1 with an error', async () => {
    const deps = makeDeps({
      torrentStash: async () => { throw new Error('boom') },
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('GONE')
    expect(w.handoff.value).toBe(false)
    expect(w.mode.value).toBe('search')
    expect(w.step.value).toBe(1)
    expect(w.errorMsg.value).toBe('boom')
    expect(w.open.value).toBe(true)
  })

  // #307: an expired/consumed stash 404s with {error:'not found'} — the raw
  // 'not found' / 'HTTP 404' message reads as gibberish, so it is translated
  // into an actionable instruction (resend the torrent to the bot).
  it('an expired stash («not found») surfaces the friendly resend message (#307)', async () => {
    const deps = makeDeps({
      torrentStash: async () => { throw new Error('not found') },
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('EXPIRED')
    expect(w.step.value).toBe(1)
    expect(w.errorMsg.value).toBe('Ссылка устарела — перешлите торрент боту ещё раз.')
  })

  it('a bare HTTP 404 (no error body) also maps to the friendly message (#307)', async () => {
    const deps = makeDeps({
      torrentStash: async () => { throw new Error('HTTP 404') },
    })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('EXPIRED')
    expect(w.errorMsg.value).toBe('Ссылка устарела — перешлите торрент боту ещё раз.')
  })

  it('on the handoff path goBack from Confirm stops at Folder (no step 1)', async () => {
    const deps = makeDeps({ torrentStash: async () => ({ kind: 'uri', uri: 'magnet:?x' }) })
    const w = useAddWizard(deps)
    await w.startFromStashedTorrent('TOK') // → step 2
    w.destination.value = '/v'
    w.goNext() // → 3
    expect(w.step.value).toBe(3)
    w.goBack() // → 2 (Folder is the floor)
    expect(w.step.value).toBe(2)
    w.goBack() // stays at 2
    expect(w.step.value).toBe(2)
  })
})

// #201 — stale «не найдено» banner: goNext/goBack must clear errorMsg so a past
// error does not bleed into the next step visit.
describe('useAddWizard — errorMsg cleared on step navigation (#201)', () => {
  it('goNext() clears errorMsg before advancing', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext() // 1 → 2

    // Simulate an error that was set on a prior submit.
    w.errorMsg.value = 'Не найдено'
    w.goNext() // 2 → 3 — errorMsg must be cleared
    expect(w.errorMsg.value).toBeNull()
  })

  it('goBack() clears errorMsg before stepping back', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext(); w.goNext() // → step 3

    // Simulate an error set on the confirm step.
    w.errorMsg.value = 'Не найдено'
    w.goBack() // 3 → 2 — errorMsg must be cleared
    expect(w.errorMsg.value).toBeNull()
  })

  it('a set errorMsg does not survive a goNext + goBack round-trip', () => {
    const w = useAddWizard(makeDeps())
    w.selectedResult.value = RESULT
    w.destination.value = '/v'
    w.goNext() // → step 2
    w.errorMsg.value = 'stale error'
    w.goNext() // → step 3: cleared by goNext
    w.errorMsg.value = 'another error'
    w.goBack() // → step 2: cleared by goBack
    expect(w.errorMsg.value).toBeNull()
  })
})
