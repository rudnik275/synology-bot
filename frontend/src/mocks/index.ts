// DEV-ONLY mock API. Patches window.fetch so every `/api/*` request the app
// makes (both src/api.ts and composables/useApi.ts hit `fetch('/api…')`) is
// served from in-memory fixtures — letting the whole design render in
// `npm run dev` with no backend. Non-/api requests (HMR, assets) pass through.
//
// Activation: only imported when import.meta.env.DEV (see main.ts), so it is
// stripped from production builds entirely. Disable at runtime with `?mock=0`
// to fall through to the real Vite proxy / backend.
import type { HealthView, TaskView } from '../types'
import {
  tasks,
  baseHealth,
  subscriptions,
  todayEpisodes,
  showTitle,
  searchResults,
  folders,
  stash,
} from './fixtures'

const MB = 1024 ** 2
const GB = 1024 ** 3

let installed = false
let nextId = 100
// First fetch of each path is slowed so the loading skeletons/spinners are
// actually visible; later (poll) ticks are snappy.
const seen = new Set<string>()

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// ── Live-ish derived data ──────────────────────────────────────────────────

/** Advance in-flight downloads a few % per poll so progress bars move; a finished
 *  one flips to seeding. Returns the current list (a fresh array each call). */
function tickTasks(): TaskView[] {
  for (const t of tasks) {
    if (t.status !== 'downloading' && t.status !== 'finishing') continue
    const step = 2 + Math.random() * 5
    t.pct = clamp(Math.round(t.pct + step), 0, 100)
    t.downloadedBytes = Math.round((t.pct / 100) * t.sizeBytes)
    t.speedBytesPerSec = Math.round((4 + Math.random() * 9) * MB)
    if (t.pct >= 100) {
      t.status = 'seeding'
      t.speedBytesPerSec = 0
      t.downloadedBytes = t.sizeBytes
    } else if (t.pct >= 97) {
      t.status = 'finishing'
    }
  }
  return tasks.map((t) => ({ ...t }))
}

/** baseHealth with a little jitter on CPU/RAM each poll so the "live" dot earns
 *  its name. Volumes/disks stay put (storage doesn't twitch second-to-second). */
function liveHealth(): HealthView {
  const cpu = baseHealth.cpu
    ? {
        userLoad: clamp(Math.round(baseHealth.cpu.userLoad + (Math.random() * 10 - 5)), 1, 99),
        systemLoad: clamp(Math.round(baseHealth.cpu.systemLoad + (Math.random() * 4 - 2)), 0, 99),
      }
    : null
  const mem = baseHealth.memory
  const memory = mem
    ? (() => {
        const used = clamp(mem.usedBytes + (Math.random() * 0.6 - 0.3) * GB, 0, mem.totalBytes)
        return { usedBytes: Math.round(used), totalBytes: mem.totalBytes, pct: Math.round((used / mem.totalBytes) * 100) }
      })()
    : null
  return { ...baseHealth, cpu, memory }
}

// ── Mutations ───────────────────────────────────────────────────────────────

function setTaskStatus(id: string, status: string): void {
  const t = tasks.find((x) => x.id === id)
  if (t) {
    t.status = status
    if (status === 'paused') t.speedBytesPerSec = 0
  }
}

function removeTask(id: string): void {
  const i = tasks.findIndex((x) => x.id === id)
  if (i >= 0) tasks.splice(i, 1)
}

function titleFromUri(uri: string): string {
  const m = /[?&]dn=([^&]+)/.exec(uri)
  return m ? decodeURIComponent(m[1]!.replace(/\+/g, ' ')) : 'New download'
}

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
  const b = init?.body
  if (!b) return {}
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  if (b instanceof FormData) {
    const file = b.get('file')
    return {
      destination: b.get('destination'),
      title: file instanceof File ? file.name : 'upload.torrent',
    }
  }
  return {}
}

function addTask(body: Record<string, unknown>): void {
  const uri = typeof body.uri === 'string' ? body.uri : ''
  const title =
    (typeof body.title === 'string' && body.title) || (uri ? titleFromUri(uri) : 'New download')
  const destination = typeof body.destination === 'string' ? body.destination : '/volume1/downloads'
  tasks.unshift({
    id: `t${nextId++}`,
    title,
    status: 'downloading',
    sizeBytes: Math.round((2 + Math.random() * 20) * GB),
    downloadedBytes: 0,
    speedBytesPerSec: Math.round(8 * MB),
    pct: 0,
    destination,
  })
}

// ── Router ──────────────────────────────────────────────────────────────────

async function route(path: string, query: URLSearchParams, method: string, init?: RequestInit): Promise<Response> {
  const seg = path.split('/').filter(Boolean)

  // /health
  if (seg[0] === 'health' && seg.length === 1) return json(liveHealth())

  // /tasks…
  if (seg[0] === 'tasks') {
    if (seg.length === 1) {
      if (method === 'GET') return json({ tasks: tickTasks() })
      if (method === 'POST') {
        addTask(await readBody(init))
        return json({ ok: true })
      }
    }
    if (seg.length === 2 && method === 'DELETE') {
      removeTask(seg[1]!)
      return json({ ok: true })
    }
    if (seg.length === 3 && method === 'POST' && seg[2] === 'pause') {
      setTaskStatus(seg[1]!, 'paused')
      return json({ ok: true })
    }
    if (seg.length === 3 && method === 'POST' && seg[2] === 'resume') {
      setTaskStatus(seg[1]!, 'downloading')
      return json({ ok: true })
    }
  }

  // /torrent-stash/:token
  if (seg[0] === 'torrent-stash' && seg.length === 2 && method === 'GET') {
    return json(stash(seg[1]!))
  }

  // /search?q=
  if (seg[0] === 'search' && seg.length === 1 && method === 'GET') {
    return json({ results: searchResults(query.get('q')) })
  }

  // /folders?path=
  if (seg[0] === 'folders' && seg.length === 1 && method === 'GET') {
    return json({ folders: folders(query.get('path')) })
  }

  // /subscriptions…
  if (seg[0] === 'subscriptions') {
    if (seg.length === 1) {
      if (method === 'GET') return json({ subscriptions })
      if (method === 'POST') {
        const body = await readBody(init)
        const showId = Number(body.showId)
        const sub = { id: `s${nextId++}`, showId, title: showTitle(showId), lastNotifiedEpisode: null }
        subscriptions.push(sub)
        return json({ subscription: sub })
      }
    }
    if (seg.length === 2 && seg[1] === 'today' && method === 'GET') {
      return json({ episodes: todayEpisodes })
    }
    if (seg.length === 2 && method === 'DELETE') {
      const i = subscriptions.findIndex((s) => s.id === seg[1])
      if (i >= 0) subscriptions.splice(i, 1)
      return json({ ok: true })
    }
  }

  return json({ error: `mock: no route for ${method} /api${path}` }, 404)
}

// ── Install ─────────────────────────────────────────────────────────────────

export function installMockApi(): void {
  if (installed) return
  if (new URLSearchParams(location.search).get('mock') === '0') {
    // eslint-disable-next-line no-console
    console.info('[mock] disabled via ?mock=0 — using real /api proxy')
    return
  }
  installed = true

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(rawUrl, location.origin)

    if (!url.pathname.startsWith('/api')) return realFetch(input, init)

    const path = url.pathname.replace(/^\/api/, '')
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

    // First touch of a GET path is slowed so loading states are visible.
    const key = `${method} ${path}`
    const first = method === 'GET' && !seen.has(key)
    seen.add(key)
    await delay(first ? 650 : method === 'GET' ? 120 : 200)

    try {
      return await route(path, url.searchParams, method, init)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'mock error' }, 500)
    }
  }

  // eslint-disable-next-line no-console
  console.info('[mock] API mocking active — all /api/* served from src/mocks. Disable with ?mock=0')
}
