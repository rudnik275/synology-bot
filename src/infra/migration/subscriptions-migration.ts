import { existsSync, renameSync } from 'node:fs'
import type { PersistentStore } from '../persistence/store.ts'
import type { Subscription } from '../../domain/subscription.ts'

/** Old v1.7.8 shape stored in db/data.json */
interface OldTvShow {
  id: number
  title: string
  [key: string]: unknown
}

/**
 * One-time migration: if the table is empty AND the legacy JSON file exists,
 * import its contents into the subscriptions table then rename the file to .migrated.
 *
 * Idempotent: if the table already has rows, migration is skipped entirely.
 * If the JSON file doesn't exist, it's a no-op.
 */
export async function migrateJsonSubscriptions(
  store: PersistentStore,
  jsonPath: string
): Promise<void> {
  // If table already has data → skip
  const existing = store.listSubscriptions()
  if (existing.length > 0) {
    return
  }

  // If JSON file doesn't exist → no-op
  if (!existsSync(jsonPath)) {
    return
  }

  const raw = await Bun.file(jsonPath).text()
  let oldData: Record<string, OldTvShow>
  try {
    oldData = JSON.parse(raw) as Record<string, OldTvShow>
  } catch {
    console.error('[migration] Failed to parse legacy subscriptions JSON — skipping.')
    return
  }

  // Import each entry into the subscriptions table
  for (const [key, show] of Object.entries(oldData)) {
    const sub: Subscription = {
      id: String(key),
      showId: show.id,
      title: show.title,
    }
    store.addSubscription(sub)
  }

  // Rename original file to .migrated as backup
  renameSync(jsonPath, `${jsonPath}.migrated`)

  console.log(
    `[migration] Migrated ${Object.keys(oldData).length} subscriptions from ${jsonPath} → ${jsonPath}.migrated`
  )
}
