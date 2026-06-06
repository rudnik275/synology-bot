/**
 * Task routes: list, pause, resume, delete, create, inspect, commit.
 * Registered under /api/tasks (auth middleware applied by createServer).
 */
import type { Hono, Context } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { SynologyClient } from '../../infra/synology/client.ts'
import type { TolokaClient } from '../../infra/toloka/client.ts'
import { parseTorrentFiles } from '../../infra/torrent/bencode.ts'
import { tryResult } from '../../lib/result.ts'
import { respondResult, requireString, requireIntArray } from '../respond.ts'
import { serializeTask } from '../serializers.ts'

export interface TaskRouteDeps {
  synology: SynologyClient
  toloka: TolokaClient
  tolokaBaseUrl: string
  miniappUrl: string
}

// ─── Internal stash helpers (shared between whole-torrent add and inspect) ────

function isTolokaUrl(uri: string, tolokaBaseUrl: string): boolean {
  try {
    return new URL(uri).host === new URL(tolokaBaseUrl).host
  } catch {
    return false
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createTorrentStash(miniappUrl: string) {
  const SERVE_TTL_MS = 15 * 60 * 1000
  const servedTorrents = new Map<string, { bytes: Uint8Array; expiresAt: number }>()

  function stashServedTorrent(bytes: Uint8Array): string {
    const now = Date.now()
    for (const [k, v] of servedTorrents) if (v.expiresAt <= now) servedTorrents.delete(k)
    const token = crypto.randomUUID().replace(/-/g, '')
    servedTorrents.set(token, { bytes, expiresAt: now + SERVE_TTL_MS })
    return token
  }

  function torrentFileUrl(token: string): string | null {
    return miniappUrl ? `${miniappUrl.replace(/\/$/, '')}/torrent-file/${token}.torrent` : null
  }

  function servedUrlForBytes(bytes: Uint8Array): { url: string; token: string } | null {
    if (!miniappUrl) return null
    const token = stashServedTorrent(bytes)
    const url = torrentFileUrl(token)
    return url ? { url, token } : null
  }

  function servedUrlForToken(token: string): string | null {
    const entry = servedTorrents.get(token)
    if (!entry || entry.expiresAt <= Date.now()) return null
    return torrentFileUrl(token)
  }

  function getTorrentEntry(token: string): { bytes: Uint8Array; expiresAt: number } | undefined {
    return servedTorrents.get(token)
  }

  function deleteTorrentEntry(token: string): void {
    servedTorrents.delete(token)
  }

  return { servedUrlForBytes, servedUrlForToken, getTorrentEntry, deleteTorrentEntry }
}

type TorrentStash = ReturnType<typeof createTorrentStash>

async function resolveSource(
  c: Context<AppEnv>,
  toloka: TolokaClient,
  tolokaBaseUrl: string,
  stash: TorrentStash
): Promise<
  | { ok: true; url: string; destination: string; bytes?: Uint8Array; token?: string }
  | { ok: false; status: 400 | 502; error: string }
> {
  const contentType = c.req.header('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.['file']
    const destination = body?.['destination']
    if (!(file instanceof File) || typeof destination !== 'string' || !destination) {
      return { ok: false, status: 400, error: 'file and destination are required' }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const served = stash.servedUrlForBytes(bytes)
    if (!served) return { ok: false, status: 502, error: 'MINIAPP_URL is not configured' }
    return { ok: true, url: served.url, destination, bytes, token: served.token }
  }

  const body = await c.req.json().catch(() => null)
  const uri = (body as Record<string, unknown> | null)?.uri
  const destination = (body as Record<string, unknown> | null)?.destination
  if (typeof uri !== 'string' || !uri || typeof destination !== 'string' || !destination) {
    return { ok: false, status: 400, error: 'uri and destination are required' }
  }

  if (!uri.startsWith('magnet:') && isTolokaUrl(uri, tolokaBaseUrl)) {
    const downloaded = await tryResult(() => toloka.downloadTorrent(uri))
    if (!downloaded.ok) return { ok: false, status: 502, error: downloaded.reason }
    const served = stash.servedUrlForBytes(downloaded.data)
    if (!served) return { ok: false, status: 502, error: 'MINIAPP_URL is not configured' }
    return { ok: true, url: served.url, destination, bytes: downloaded.data, token: served.token }
  }

  return { ok: true, url: uri, destination }
}

// ─── Route registrar ──────────────────────────────────────────────────────────

/**
 * Register the open torrent-file serving route (no auth — DSM can't sign initData).
 * Must be called BEFORE the auth middleware is applied.
 */
export function registerTorrentFileRoute(app: Hono<AppEnv>, stash: TorrentStash): void {
  app.get('/torrent-file/:file', (c) => {
    const token = c.req.param('file').replace(/\.torrent$/i, '')
    const entry = stash.getTorrentEntry(token)
    if (!entry || entry.expiresAt <= Date.now()) {
      stash.deleteTorrentEntry(token)
      return c.json({ error: 'not found' }, 404)
    }
    return c.body(new Uint8Array(entry.bytes), 200, {
      'Content-Type': 'application/x-bittorrent',
      'Content-Disposition': `attachment; filename="${token}.torrent"`,
    })
  })
}

/**
 * Register all /api/tasks routes. The auth middleware must already be in place
 * for /api/* before this is called.
 */
export function registerTaskRoutes(app: Hono<AppEnv>, deps: TaskRouteDeps, stash: TorrentStash): void {
  const { synology, toloka, tolokaBaseUrl } = deps

  // --- Tasks: read ---

  app.get('/api/tasks', async (c) => {
    const result = await synology.listTasks()
    if (!result.ok) return respondResult(c, result)
    return c.json({ tasks: result.data.map(serializeTask) })
  })

  // --- Tasks: actions ---

  app.post('/api/tasks/:id/pause', async (c) => {
    const result = await synology.pauseTask(c.req.param('id'))
    return respondResult(c, result)
  })

  app.post('/api/tasks/:id/resume', async (c) => {
    const result = await synology.resumeTask(c.req.param('id'))
    return respondResult(c, result)
  })

  app.delete('/api/tasks/:id', async (c) => {
    const deleteFiles = c.req.query('deleteFiles') === 'true'
    const result = await synology.deleteTask(c.req.param('id'), deleteFiles)
    return respondResult(c, result)
  })

  // --- Tasks: create whole torrent (unified, per #58) ---

  app.post('/api/tasks', async (c) => {
    const src = await resolveSource(c, toloka, tolokaBaseUrl, stash)
    if (!src.ok) return c.json({ error: src.error }, src.status)
    const result = await synology.createDownloadTask(src.url, src.destination)
    if (!result.ok) return respondResult(c, result)
    // Echo the created task id so the Mini App's optimistic card can cancel it
    // before the next poll picks it up (id omitted if DSM returned none).
    return c.json({ ok: true, id: result.id }, 201)
  })

  // --- Per-file selection (#123): inspect → (client picks files) → commit ---
  //
  // • BYTES we hold (multipart upload / Toloka download): parse the file tree
  //   LOCALLY (bencode, ~1ms) and return it INSTANTLY with an `inspectToken` —
  //   WITHOUT touching DSM. createInspectList is DEFERRED to the optimistic
  //   commit (POST /tasks/commit). Bonus: no DSM list created here → backing
  //   out of Confirm leaves no orphan.
  //
  // • Magnets (no local bytes): create the list NOW and return `{listId}`;
  //   the client polls GET /tasks/inspect/:id for the tree DSM fetches from
  //   peers, then commits by listId (unchanged two-call path).

  app.post('/api/tasks/inspect', async (c) => {
    const src = await resolveSource(c, toloka, tolokaBaseUrl, stash)
    if (!src.ok) return c.json({ error: src.error }, src.status)
    if (src.bytes && src.token) {
      try {
        const files = parseTorrentFiles(src.bytes).map((f, index) => ({ index, name: f.path, size: f.length }))
        if (files.length > 0) return c.json({ inspectToken: src.token, files }, 201)
        console.warn(`[inspect] local parse yielded 0 files (${src.bytes.length}B) — falling back to DSM create+poll`)
      } catch (err) {
        console.warn(`[inspect] local bencode parse failed (${src.bytes.length}B), falling back to DSM create+poll: ${errorMessage(err)}`)
      }
    }
    const result = await synology.createInspectList(src.url, src.destination)
    if (!result.ok) return respondResult(c, result)
    return c.json({ listId: result.listId }, 201)
  })

  app.get('/api/tasks/inspect/:listId', async (c) => {
    const result = await synology.getInspectList(c.req.param('listId'))
    if (!result.ok) return respondResult(c, result)
    const files = result.data.files ?? []
    return c.json({
      ready: files.length > 0,
      title: result.data.title ?? '',
      size: result.data.size ?? 0,
      files: files.map((f) => ({ index: f.index, name: f.name, size: f.size })),
    })
  })

  app.delete('/api/tasks/inspect/:listId', async (c) => {
    const result = await synology.deleteInspectList(c.req.param('listId'))
    return respondResult(c, result)
  })

  // Commit the chosen files (`selected` = indices to KEEP) into a real task.
  // Two handles, mirroring inspect:
  //   • `inspectToken` (instant-tree path): DSM was never touched at inspect time,
  //     so create the list NOW from the still-stashed bytes, then commit it.
  //   • `listId` (magnet path): the list was already created at inspect time.

  app.post('/api/tasks/commit', async (c) => {
    const body = await c.req.json().catch(() => null)
    const listId = (body as Record<string, unknown> | null)?.listId
    const inspectToken = (body as Record<string, unknown> | null)?.inspectToken
    const destGuard = requireString(body, 'destination')
    if (!destGuard.ok) return c.json({ error: destGuard.error }, 400)
    const destination = destGuard.value
    const selectedGuard = requireIntArray(body, 'selected')
    if (!selectedGuard.ok) return c.json({ error: selectedGuard.error }, 400)
    const selected = selectedGuard.value
    let listIdToCommit: string
    let createdFromToken = false
    if (typeof inspectToken === 'string' && inspectToken) {
      const url = stash.servedUrlForToken(inspectToken)
      if (!url) return c.json({ error: 'inspect expired — reopen the torrent' }, 410)
      const created = await synology.createInspectList(url, destination)
      if (!created.ok) return respondResult(c, created)
      listIdToCommit = created.listId
      createdFromToken = true
    } else if (typeof listId === 'string' && listId) {
      listIdToCommit = listId
    } else {
      return c.json({ error: 'listId or inspectToken is required' }, 400)
    }
    const result = await synology.commitInspectList(listIdToCommit, selected, destination)
    if (!result.ok) {
      if (createdFromToken) void synology.deleteInspectList(listIdToCommit)
      return respondResult(c, result)
    }
    // Echo the committed task id (see POST /api/tasks) for optimistic cancel.
    return c.json({ ok: true, id: result.id }, 201)
  })
}
