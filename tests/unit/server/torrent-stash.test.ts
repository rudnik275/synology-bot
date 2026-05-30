import { describe, it, expect } from 'bun:test'
import { createServer } from '../../../src/server/server.ts'
import type { SynologyClient } from '../../../src/infra/synology/client.ts'
import type { TolokaClient } from '../../../src/infra/toloka/client.ts'
import type { DockerClient } from '../../../src/infra/docker/client.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42
const STASH = new Uint8Array([0x64, 0x31, 0x30, 0x3a]) // "d10:"

function makeApp(stash?: { fileName: string; data: Uint8Array }) {
  return createServer({
    synology: {} as unknown as SynologyClient,
    toloka: { downloadTorrent: async () => new Uint8Array() } as unknown as TolokaClient,
    docker: {} as unknown as DockerClient,
    store: {
      listSubscriptions: () => [],
      getSubscription: () => undefined,
      addSubscription: () => {},
      removeSubscription: () => {},
    },
    getShowById: async () => ({ title: 'x' }),
    getTodayEpisodes: async () => [],
    tolokaBaseUrl: 'https://toloka.to',
    botToken: TEST_BOT_TOKEN,
    ownerId: OWNER_ID,
    initDataMaxAgeSeconds: 0,
    torrentStash: { getTorrentStash: () => stash },
  })
}

function ownerHeaders() {
  return { Authorization: `tma ${buildInitData({ id: OWNER_ID })}` }
}

describe('GET /api/torrent-stash/:token', () => {
  it('returns { name, base64 } for a present token', async () => {
    const res = await makeApp({ fileName: 'movie.torrent', data: STASH }).request(
      '/api/torrent-stash/tok-1',
      { headers: ownerHeaders() }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; base64: string }
    expect(body.name).toBe('movie.torrent')
    expect(Array.from(Buffer.from(body.base64, 'base64'))).toEqual(Array.from(STASH))
  })

  it('returns 404 when the token is missing or expired', async () => {
    const res = await makeApp(undefined).request('/api/torrent-stash/gone', {
      headers: ownerHeaders(),
    })
    expect(res.status).toBe(404)
  })

  it('requires owner auth (401 without initData)', async () => {
    const res = await makeApp({ fileName: 'x.torrent', data: STASH }).request(
      '/api/torrent-stash/tok-1'
    )
    expect(res.status).toBe(401)
  })
})
