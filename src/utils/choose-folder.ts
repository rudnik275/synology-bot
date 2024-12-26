import type {BotContext} from '../types.ts'
import {getFoldersList} from './synology-api.ts'
import {type Conversation} from '@grammyjs/conversations'

export const chooseFolder = async (conversation: Conversation<BotContext>, ctx: BotContext) => {
  const folders = await getFoldersList()

  await ctx.reply('📁 Choose destination folder', {
    reply_markup: {
      inline_keyboard: [
        folders.map(f => ({
          text: f,
          callback_data: f
        })),
        [
          {
            text: '⬅️',
            callback_data: '__back'
          }
        ]
      ]
    }
  })

  const action = await conversation.waitFor('callback_query:data')
  const cbData = action.callbackQuery.data

  if (cbData === '__back') return

  return cbData
}
