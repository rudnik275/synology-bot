import {type ConversationFlavor} from '@grammyjs/conversations'
import type {Context, SessionFlavor} from 'grammy'

export interface SynologyTask {
  id: string
  status: number
  size: number
  title: string
  additional: {
    detail: any
    transfer: {
      size_downloaded: number
      speed_download: number
      size_uploaded: number
    }
  }
}

export type EditTaskAction = 'resume' | 'pause' | 'delete'

export type BotContext = Context & ConversationFlavor & SessionFlavor<{
  selectedTask: SynologyTask
}>

export interface TolokaResultItem {
  title: string
  url: string
  size: string
}
