import type {TvShow, TvShowDetailed} from '../types.ts'

export const formatSubscription = (tvShow: TvShow) => `${tvShow.title} / ${tvShow.titleOriginal} (${tvShow.year}), ${tvShow.status}`
export const formatTvShowDetailed = (tvShowDetailed: TvShowDetailed) => formatSubscription(tvShowDetailed) // TODO: add episodes and IMDB
