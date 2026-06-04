/**
 * Torrent stash route: fetch what the bot stashed (#99, #120).
 * A stash holds either a .torrent's BYTES or a magnet/URL string.
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { TorrentStashReader } from '../server.ts'

export interface TorrentStashRouteDeps {
  torrentStash?: TorrentStashReader
}

export function registerTorrentStashRoute(app: Hono<AppEnv>, deps: TorrentStashRouteDeps): void {
  // Sits under the /api/* owner guard — the token is a fetch key, not a capability.
  app.get('/api/torrent-stash/:token', (c) => {
    const stash = deps.torrentStash?.getTorrentStash(c.req.param('token'))
    if (!stash) return c.json({ error: 'not found' }, 404)
    if (stash.kind === 'uri') {
      return c.json({ kind: 'uri', uri: stash.uri })
    }
    return c.json({
      kind: 'bytes',
      name: stash.fileName,
      base64: Buffer.from(stash.data).toString('base64'),
    })
  })
}
