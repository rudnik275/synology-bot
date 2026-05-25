import type { Context, NextFunction } from 'grammy'
import type { PersistentStore } from '../../infra/persistence/store.ts'

export function createOwnerOnlyMiddleware(
  ownerChatId: number,
  store: PersistentStore
) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (ctx.chat?.type === 'private' && ctx.chat.id === ownerChatId) {
      store.setKv('owner_chat_id', String(ctx.chat.id))
      await next()
    }
    // Non-owner: silent return
  }
}
