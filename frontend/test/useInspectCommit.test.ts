// Unit tests for the useInspectCommit composable (#171) — the add-flow
// inspect→commit state machine in isolation, driven by a stubbed `api` (no full
// AddFlow mount). Asserts EXTERNAL behavior only: which api calls fire and what
// state the machine lands in — never the private seq counter or protect flag.
import { describe, it, expect } from 'bun:test'
import { flushPromises } from '@vue/test-utils'
import { useInspectCommit, type InspectApi, type InspectSource } from '../src/composables/useInspectCommit'
import type { InspectStarted } from '../src/types'

type PollResult = { ready: boolean; files: { index: number; name: string; size: number }[] }

interface Calls {
  inspect: Array<{ uri: string; destination: string; title?: string }>
  inspectFile: Array<{ name: string; destination: string }>
  pollInspect: string[]
  deleteInspect: string[]
}

/** Build a stub api + a record of the calls made against it. */
function makeApi(opts: {
  started?: InspectStarted | Promise<InspectStarted>
  startedFile?: InspectStarted | Promise<InspectStarted>
  poll?: PollResult | (() => PollResult)
} = {}): { api: InspectApi; calls: Calls } {
  const calls: Calls = { inspect: [], inspectFile: [], pollInspect: [], deleteInspect: [] }
  const api: InspectApi = {
    inspect: (uri, destination, title) => {
      calls.inspect.push({ uri, destination, title })
      return Promise.resolve(opts.started ?? { listId: 'L1' })
    },
    inspectFile: (file, destination) => {
      calls.inspectFile.push({ name: file.name, destination })
      return Promise.resolve(opts.startedFile ?? opts.started ?? { listId: 'L1' })
    },
    pollInspect: (listId) => {
      calls.pollInspect.push(listId)
      const p = typeof opts.poll === 'function' ? opts.poll() : opts.poll
      return Promise.resolve(p ?? { ready: true, files: [] })
    },
    deleteInspect: (listId) => {
      calls.deleteInspect.push(listId)
      return Promise.resolve(undefined)
    },
  }
  return { api, calls }
}

const SEARCH_SOURCE: InspectSource = { kind: 'search', url: 'https://toloka.to/dl?id=1', title: 'Andor S02', destination: '/volume1/downloads' }
const FILE_SOURCE = (): InspectSource => ({ kind: 'file', file: new File(['x'], 'Andor.torrent'), destination: '/volume1/downloads' })

const FILES = [
  { index: 0, name: 'Andor/E01.mkv', size: 100 },
  { index: 1, name: 'Andor/E02.mkv', size: 200 },
]

describe('useInspectCommit — held-bytes (instant tree) path', () => {
  it('renders the tree and goes ready WITHOUT polling', async () => {
    const { api, calls } = makeApi({ started: { inspectToken: 'TOK', files: FILES } })
    const ic = useInspectCommit(api)

    const outcome = await ic.runInspect(SEARCH_SOURCE)

    expect(ic.inspectState.value).toBe('ready')
    expect(ic.commitHandle.value).toEqual({ inspectToken: 'TOK' })
    // The tree is mapped to the view shape (name → path) and all files ticked.
    expect(ic.inspectFiles.value).toEqual([
      { index: 0, path: 'Andor/E01.mkv', size: 100 },
      { index: 1, path: 'Andor/E02.mkv', size: 200 },
    ])
    expect(ic.selectedIndices.value).toEqual([0, 1])
    // No poll on the instant-tree path.
    expect(calls.pollInspect).toHaveLength(0)
    expect(outcome).toEqual({ kind: 'ready', handle: { inspectToken: 'TOK' }, indices: [0, 1] })
  })

  it('inspects an uploaded file as multipart (inspectFile, not inspect)', async () => {
    const { api, calls } = makeApi({ startedFile: { inspectToken: 'TOKF', files: FILES } })
    const ic = useInspectCommit(api)

    await ic.runInspect(FILE_SOURCE())

    expect(calls.inspectFile).toHaveLength(1)
    expect(calls.inspectFile[0]!.name).toBe('Andor.torrent')
    expect(calls.inspect).toHaveLength(0)
    expect(ic.commitHandle.value).toEqual({ inspectToken: 'TOKF' })
  })

  it('a null source (magnet/uri handoff) resolves straight to whole', async () => {
    const { api, calls } = makeApi()
    const ic = useInspectCommit(api)

    const outcome = await ic.runInspect(null)

    expect(ic.inspectState.value).toBe('whole')
    expect(outcome).toEqual({ kind: 'whole' })
    expect(calls.inspect).toHaveLength(0)
    expect(calls.inspectFile).toHaveLength(0)
  })
})

describe('useInspectCommit — magnet (poll) path', () => {
  it('polls then goes ready with the polled tree', async () => {
    const { api, calls } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: true, files: FILES } })
    const ic = useInspectCommit(api)

    const outcome = await ic.runInspect(SEARCH_SOURCE)

    expect(calls.pollInspect).toEqual(['LMAG'])
    expect(ic.inspectState.value).toBe('ready')
    expect(ic.commitHandle.value).toEqual({ listId: 'LMAG' })
    expect(ic.selectedIndices.value).toEqual([0, 1])
    expect(outcome).toEqual({ kind: 'ready', handle: { listId: 'LMAG' }, indices: [0, 1] })
  })

  it('a magnet that parses no files falls back to whole', async () => {
    const { api, calls } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: true, files: [] } })
    const ic = useInspectCommit(api)

    const outcome = await ic.runInspect(SEARCH_SOURCE)

    expect(calls.pollInspect).toEqual(['LMAG'])
    expect(ic.inspectState.value).toBe('whole')
    expect(outcome).toEqual({ kind: 'whole' })
  })

  it('an inspect that throws falls back to whole and records the error', async () => {
    const { api } = makeApi()
    api.inspect = () => Promise.reject(new Error('boom'))
    const ic = useInspectCommit(api)

    const outcome = await ic.runInspect(SEARCH_SOURCE)

    expect(ic.inspectState.value).toBe('whole')
    expect(ic.inspectError.value).toBe('boom')
    expect(outcome).toEqual({ kind: 'whole' })
  })
})

describe('useInspectCommit — magnet poll hint + timeout (#304)', () => {
  // Tiny injected delays so the timeout path doesn't take ~30 s of wall clock.
  const FAST = { pollIntervalMs: 1, hintAfterAttempts: 2, pollAttempts: 4 }

  it('shows the peer-wait hint after a few not-ready polls, clears it on ready', async () => {
    let polls = 0
    const { api } = makeApi({
      started: { listId: 'LMAG' },
      poll: () => (++polls >= 3 ? { ready: true, files: FILES } : { ready: false, files: [] }),
    })
    const ic = useInspectCommit(api, FAST)

    expect(ic.inspectHint.value).toBeNull()
    const outcome = await ic.runInspect(SEARCH_SOURCE)

    // The hint was set during the wait (observable post-hoc via the final state
    // transitions): it must be CLEARED once the metadata arrived.
    expect(outcome.kind).toBe('ready')
    expect(ic.inspectHint.value).toBeNull()
    expect(ic.inspectTimedOut.value).toBe(false)
  })

  it('the hint is visible WHILE waiting on peers (not-ready polls past the threshold)', async () => {
    let polls = 0
    let sawHintDuringWait: string | null = null
    const { api } = makeApi()
    const ic = useInspectCommit(api, FAST)
    api.inspect = () => Promise.resolve({ listId: 'LMAG' })
    api.pollInspect = () => {
      polls++
      // Capture the hint state as the NEXT poll fires — after 2 not-ready polls
      // (hintAfterAttempts) the hint must be up.
      if (polls === 3) sawHintDuringWait = ic.inspectHint.value
      return Promise.resolve({ ready: polls >= 3 ? true : false, files: polls >= 3 ? FILES : [] })
    }

    await ic.runInspect(SEARCH_SOURCE)

    expect(sawHintDuringWait).toBe('⏳ Ожидание метаданных от пиров…')
  })

  it('exhausting the poll attempts marks a TIMEOUT (whole fallback, no inspectError)', async () => {
    const { api, calls } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: false, files: [] } })
    const ic = useInspectCommit(api, FAST)

    const outcome = await ic.runInspect(SEARCH_SOURCE)

    expect(calls.pollInspect).toHaveLength(FAST.pollAttempts)
    expect(outcome).toEqual({ kind: 'whole' })
    expect(ic.inspectState.value).toBe('whole')
    expect(ic.inspectTimedOut.value).toBe(true) // timeout, distinct from a failure…
    expect(ic.inspectError.value).toBeNull() // …no error recorded
    expect(ic.inspectHint.value).toBeNull() // hint cleared once settled
  })

  it('a magnet that parses zero files is whole but NOT a timeout', async () => {
    const { api } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: true, files: [] } })
    const ic = useInspectCommit(api, FAST)

    await ic.runInspect(SEARCH_SOURCE)

    expect(ic.inspectState.value).toBe('whole')
    expect(ic.inspectTimedOut.value).toBe(false)
  })

  it('resetInspect clears the hint + timeout flags', async () => {
    const { api } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: false, files: [] } })
    const ic = useInspectCommit(api, FAST)
    await ic.runInspect(SEARCH_SOURCE)
    expect(ic.inspectTimedOut.value).toBe(true)

    ic.resetInspect()

    expect(ic.inspectTimedOut.value).toBe(false)
    expect(ic.inspectHint.value).toBeNull()
  })
})

describe('useInspectCommit — stale run (reset / re-open mid-flight)', () => {
  it('a run made stale by resetInspect does not mutate state and releases its list', async () => {
    // Gate the inspect so we can reset BEFORE it resolves.
    let release!: (s: InspectStarted) => void
    const gate = new Promise<InspectStarted>((r) => { release = r })
    const { api, calls } = makeApi()
    api.inspect = (uri, destination, title) => { calls.inspect.push({ uri, destination, title }); return gate }
    const ic = useInspectCommit(api)

    const p = ic.runInspect(SEARCH_SOURCE)
    expect(ic.inspectState.value).toBe('inspecting')

    // Re-open mid-flight: reset bumps the seq, invalidating the in-flight run.
    ic.resetInspect()
    expect(ic.inspectState.value).toBe('idle')

    // The late resolution (a magnet list) must NOT land state — and it best-effort
    // releases the now-orphaned NAS list.
    release({ listId: 'STALE' })
    const outcome = await p

    expect(outcome).toEqual({ kind: 'whole' })
    expect(ic.inspectState.value).toBe('idle') // unchanged by the stale run
    expect(ic.inspectFiles.value).toEqual([])
    expect(calls.deleteInspect).toEqual(['STALE'])
  })
})

describe('useInspectCommit — fast-tap chained commit (#161)', () => {
  it('the in-flight promise resolves the real outcome even after resetInspect clears refs', async () => {
    let release!: (s: InspectStarted) => void
    const gate = new Promise<InspectStarted>((r) => { release = r })
    const { api } = makeApi()
    api.inspect = () => gate
    const ic = useInspectCommit(api)

    ic.runInspect(SEARCH_SOURCE)
    expect(ic.inspectState.value).toBe('inspecting')

    // Fast-tap: capture the in-flight promise + protect it, then resetForm clears refs.
    const pending = ic.inFlight()!
    expect(pending).not.toBeNull()
    ic.protectInflight()
    ic.resetInspect() // sheet closes — refs cleared, but protected run survives

    // The protected run still settles with the real handle + indices.
    release({ inspectToken: 'TOK', files: FILES })
    const outcome = await pending
    ic.releaseInflight()

    expect(outcome).toEqual({ kind: 'ready', handle: { inspectToken: 'TOK' }, indices: [0, 1] })
    // The commit would use the OUTCOME's handle/indices, not the cleared refs.
    expect(ic.commitHandle.value).toBeNull() // releaseInflight nulled it
  })

  it('a STALE releaseInflight does NOT clobber a newer session\'s commitHandle (#294)', async () => {
    // Fast-tap chain settling AFTER the user reopened the wizard and a NEW
    // inspect set a new commitHandle: the old chain's releaseInflight must be a
    // no-op, or the new session's per-file selection silently degrades to a
    // whole-torrent add.
    let releaseFirst!: (s: InspectStarted) => void
    const firstGate = new Promise<InspectStarted>((r) => { releaseFirst = r })
    const { api } = makeApi({ started: { inspectToken: 'TOK2', files: FILES } })
    const realInspect = api.inspect
    let call = 0
    api.inspect = (uri, destination, title) =>
      ++call === 1 ? firstGate : realInspect(uri, destination, title)
    const ic = useInspectCommit(api)

    // Session A: inspect in flight, fast-tap protects it, sheet closes (reset).
    ic.runInspect(SEARCH_SOURCE)
    const pendingA = ic.inFlight()!
    ic.protectInflight()
    ic.resetInspect()

    // Session B: wizard reopened, NEW inspect resolves and sets a NEW handle.
    await ic.runInspect(SEARCH_SOURCE)
    expect(ic.commitHandle.value).toEqual({ inspectToken: 'TOK2' })

    // Session A's run finally settles (stale) and its chain releases.
    releaseFirst({ inspectToken: 'TOK1', files: FILES })
    await pendingA
    ic.releaseInflight()

    // B's handle survives — the stale release must not null it.
    expect(ic.commitHandle.value).toEqual({ inspectToken: 'TOK2' })
    expect(ic.inspectState.value).toBe('ready')
  })

  it('after a stale protect, resetInspect in the NEW session works normally (#294)', async () => {
    // Session A protected, then a new run B started (which makes A's protection
    // moot). A later resetInspect must invalidate B normally — the leftover
    // protect flag from A must not suppress B's stale-run guard.
    let releaseA!: (s: InspectStarted) => void
    const gateA = new Promise<InspectStarted>((r) => { releaseA = r })
    let releaseB!: (s: InspectStarted) => void
    const gateB = new Promise<InspectStarted>((r) => { releaseB = r })
    const { api } = makeApi()
    let call = 0
    api.inspect = () => (++call === 1 ? gateA : gateB)
    const ic = useInspectCommit(api)

    ic.runInspect(SEARCH_SOURCE)
    ic.protectInflight()
    ic.resetInspect() // sheet closed; A protected

    const pB = ic.runInspect(SEARCH_SOURCE) // reopen → session B
    ic.resetInspect() // close again — must make B stale (seq bump despite A's old flag)
    releaseB({ inspectToken: 'TOKB', files: FILES })
    const outcomeB = await pB
    expect(outcomeB).toEqual({ kind: 'whole' }) // B was correctly invalidated
    expect(ic.commitHandle.value).toBeNull()

    releaseA({ inspectToken: 'TOKA', files: FILES })
  })

  it('inFlight() is null once the run settles', async () => {
    const { api } = makeApi({ started: { inspectToken: 'TOK', files: FILES } })
    const ic = useInspectCommit(api)

    const p = ic.runInspect(SEARCH_SOURCE)
    expect(ic.inFlight()).not.toBeNull()
    await p
    await flushPromises()
    expect(ic.inFlight()).toBeNull()
  })
})

describe('useInspectCommit — cancelInspectIfOpen', () => {
  it('on the token path does NOT delete (no NAS list exists)', async () => {
    const { api, calls } = makeApi({ started: { inspectToken: 'TOK', files: FILES } })
    const ic = useInspectCommit(api)
    await ic.runInspect(SEARCH_SOURCE)

    ic.cancelInspectIfOpen()

    expect(calls.deleteInspect).toHaveLength(0)
    expect(ic.commitHandle.value).toBeNull()
  })

  it('on the listId path deletes the list exactly once', async () => {
    const { api, calls } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: true, files: FILES } })
    const ic = useInspectCommit(api)
    await ic.runInspect(SEARCH_SOURCE)
    expect(ic.commitHandle.value).toEqual({ listId: 'LMAG' })

    ic.cancelInspectIfOpen()

    expect(calls.deleteInspect).toEqual(['LMAG'])
    expect(ic.commitHandle.value).toBeNull()
  })

  it('does not delete a listId whose inspect already fell back to whole', async () => {
    // A magnet that parsed no files lands 'whole' but still set commitHandle to the
    // list during the run; cancelInspectIfOpen must skip the delete in that state.
    const { api, calls } = makeApi({ started: { listId: 'LMAG' }, poll: { ready: true, files: [] } })
    const ic = useInspectCommit(api)
    await ic.runInspect(SEARCH_SOURCE)
    expect(ic.inspectState.value).toBe('whole')

    ic.cancelInspectIfOpen()

    expect(calls.deleteInspect).toHaveLength(0)
  })
})
