import {Bot} from 'grammy'
import type {BotContext} from '../types.ts'

const API_URL = 'https://api.myshows.me/v2/rpc/'

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
})

api.interceptors.request.use((request) => {
  Object.assign(request.data, {
    jsonrpc: '2.0',
    id: 1
  })
  return request
})
api.interceptors.response.use((response) => response.data)

export const search = (query: string) => api.post('/', {
  method: 'shows.Search',
  params: {
    query: 'house'
  },
}).then(r => r.result)

//
// добавление сериала в список подписок по id
// команда на показ текущего списка с возможностью удалить
// таймаут на каждые 24 часа который сходит по id и проверить вышла ли серия в этот день


export const registerShowsSubscription = (bot: Bot<BotContext>) => {
  return async (ctx: BotContext) => {
  }
}
