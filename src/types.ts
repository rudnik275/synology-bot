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
  subscription: {
    isAwaitsSearchQuery: boolean
    searchResults: TvShow[]
    selectedItem?: TvShow
  }
  selectedTask: SynologyTask
}>

export interface TvShow {
  id: number
  title: string
  titleOriginal: string
  description: string
  totalSeasons: number
  status: string
  year: number
  imdbRating: number
  imdbVoted: number
  image: string
}

interface TvShowEpisode {
  id: number
  title: string
  seasonNumber: number
  episodeNumber: number
  airDate: string
  airDateUTC: string
  shortName: string
  isSpecial: boolean
}

export interface TvShowDetailed extends TvShow {
  episodes: TvShowEpisode[]
}

export interface TolokaResultItem {
  title: string
  url: string
  size: string
}
