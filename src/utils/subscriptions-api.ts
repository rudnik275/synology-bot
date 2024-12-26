import type {TvShow, TvShowDetailed} from '../types.ts'
import axios, {type AxiosInstance} from 'axios'

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

export const search = (query: string) => api.post<{}, { result: TvShow[] }>('/', {
  method: 'shows.Search',
  params: {
    query,
  },
}).then(r => r.result.slice(0, 10))

export const loadTvShow = (showId: number) => api.post<{}, { result: TvShowDetailed }>('/', {
  method: 'shows.GetById',
  params: {
    showId,
    withEpisodes: true
  },
}).then(r => r.result)
