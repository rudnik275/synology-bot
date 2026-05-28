import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { ownerAuth, type AppEnv } from '../../../src/server/auth.ts'
import { buildInitData, TEST_BOT_TOKEN } from '../../helpers/init-data.ts'

const OWNER_ID = 42

function makeApp() {
  const app = new Hono<AppEnv>()
  app.use('/secure', ownerAuth({ botToken: TEST_BOT_TOKEN, ownerId: OWNER_ID, maxAgeSeconds: 0 }))
  app.get('/secure', (c) => c.json({ userId: c.get('user').id }))
  return app
}

function authHeader(initData: string) {
  return { Authorization: `tma ${initData}` }
}

describe('ownerAuth middleware', () => {
  it('401 when no Authorization header', async () => {
    const res = await makeApp().request('/secure')
    expect(res.status).toBe(401)
  })

  it('401 when header is not the "tma" scheme', async () => {
    const res = await makeApp().request('/secure', {
      headers: { Authorization: `Bearer ${buildInitData({ id: OWNER_ID })}` },
    })
    expect(res.status).toBe(401)
  })

  it('401 when initData signature is invalid', async () => {
    const bad = buildInitData({ id: OWNER_ID }).replace(/hash=[0-9a-f]+/, 'hash=deadbeef')
    const res = await makeApp().request('/secure', { headers: authHeader(bad) })
    expect(res.status).toBe(401)
  })

  it('401 when valid initData belongs to a non-owner', async () => {
    const res = await makeApp().request('/secure', {
      headers: authHeader(buildInitData({ id: 999 })),
    })
    expect(res.status).toBe(401)
  })

  it('200 and exposes the user for valid owner initData', async () => {
    const res = await makeApp().request('/secure', {
      headers: authHeader(buildInitData({ id: OWNER_ID })),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: OWNER_ID })
  })
})
