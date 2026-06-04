/**
 * Folder routes: list shared folders and subfolders for the destination picker.
 */
import type { Hono } from 'hono'
import type { AppEnv } from '../auth.ts'
import type { SynologyClient } from '../../infra/synology/client.ts'
import { respondResult } from '../respond.ts'

export interface FolderRouteDeps {
  synology: SynologyClient
}

export function registerFolderRoutes(app: Hono<AppEnv>, deps: FolderRouteDeps): void {
  const { synology } = deps

  app.get('/api/folders', async (c) => {
    const path = c.req.query('path')
    const result = path ? await synology.listFolders(path) : await synology.listSharedFolders()
    if (!result.ok) return respondResult(c, result)
    return c.json({ folders: result.data })
  })
}
