import type { Context, NextFunction } from 'grammy'
import type { PersistentStore } from '../../infra/persistence/store.ts'

export function createOwnerOnlyMiddleware(
  ownerUsername: string,
  store: PersistentStore
) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (
      ctx.chat?.type === 'private' &&
      'username' in ctx.chat &&
      ctx.chat.username === ownerUsername
    ) {
      store.setKv('owner_chat_id', String(ctx.chat.id))
      await next()
    }
    // Non-owner or missing username: silent return
  }
}
