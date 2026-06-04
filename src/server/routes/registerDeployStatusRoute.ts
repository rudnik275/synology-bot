/**
 * Deploy status route: surfaces last Watchtower check (NAS tab extra).
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { DockerClient } from '../../infra/docker/client.ts'
import { parseLastSessionDone } from '../../infra/docker/client.ts'
import { tryResult } from '../../lib/result.ts'
import { respondResult } from '../respond.ts'

export interface DeployStatusRouteDeps {
  docker: DockerClient
}

export function registerDeployStatusRoute(app: Hono<AppEnv>, deps: DeployStatusRouteDeps): void {
  const { docker } = deps

  // Not in the #58 contract; kept as a documented extra (the bot self-reports
  // deploys, and the NAS tab surfaces the last Watchtower check).
  app.get('/api/deploy-status', async (c) => {
    const r = await tryResult(() => docker.getContainerByName('watchtower'))
    if (!r.ok) return respondResult(c, r)
    const container = r.data
    if (!container) return c.json({ state: 'not_found' })
    if (container.state !== 'running') {
      return c.json({ state: 'stopped', status: container.status })
    }
    let logs = ''
    try {
      logs = await docker.getContainerLogs('watchtower', 50)
    } catch {
      // Non-fatal: the container is running; we just can't read the last check time.
    }
    const lastCheck = parseLastSessionDone(logs)
    return c.json({
      state: 'running',
      status: container.status,
      lastCheck: lastCheck ? lastCheck.toISOString() : null,
    })
  })
}
