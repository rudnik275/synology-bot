import type {TvShow, TvShowDetailed} from '../types.ts'

export const formatTvShowShort = (tvShow: TvShow) => `${tvShow.title} / ${tvShow.titleOriginal} (${tvShow.year}) [${tvShow.status}]`

function getEpisodeStatus(airDate: string): string {
  const currentDate = new Date()
  const episodeDate = new Date(airDate)

  if (episodeDate < currentDate) {
    return 'released'
  }

  return episodeDate.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function isEpisodeToday(airDate: string): boolean {
  const today = new Date()
  const episodeDate = new Date(airDate)

  return (
    today.getFullYear() === episodeDate.getFullYear() &&
    today.getMonth() === episodeDate.getMonth() &&
    today.getDate() === episodeDate.getDate()
  )
}

export const findNextEpisode = (tvShowDetailed: TvShowDetailed) => {
  const currentDate = new Date()

  // Фильтруем эпизоды, которые еще не вышли
  const upcomingEpisodes = tvShowDetailed.episodes.filter(episode => new Date(episode.airDate) > currentDate)

  // Сортируем по дате выхода
  upcomingEpisodes.sort((a, b) => new Date(a.airDate).getTime() - new Date(b.airDate).getTime())

  return upcomingEpisodes.at(0)
}

function getNextEpisode(tvShowDetailed: TvShowDetailed) {
  const nextEpisode = findNextEpisode(tvShowDetailed)
  if (nextEpisode) {
    return `(${nextEpisode.shortName}) ${
      new Date(nextEpisode.airDate).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    }`
  } else {
    return tvShowDetailed.status
  }
}

export const formatTvShowDetailed = (tvShowDetailed: TvShowDetailed) => {
  const rows = [
    `${tvShowDetailed.title} / ${tvShowDetailed.titleOriginal} (${tvShowDetailed.year})`,
    `Next episode: ${getNextEpisode(tvShowDetailed)}`,
    `IMDB - ${tvShowDetailed.imdbRating} (${tvShowDetailed.imdbVoted} voted)`,
    `Seasons - ${tvShowDetailed.totalSeasons}`,
    `\nLast season episodes:\n`
  ]

  for (const episode of tvShowDetailed.episodes) {
    if (episode.seasonNumber === tvShowDetailed.totalSeasons) {
      rows.push(
        `${episode.shortName} - ${getEpisodeStatus(episode.airDate)}`
      )
    }
  }

  return rows.join('\n')
}

export const formatTvShow = (tvShowDetailed: TvShowDetailed) => [
  `${tvShowDetailed.title} / ${tvShowDetailed.titleOriginal} (${tvShowDetailed.year})`,
  getNextEpisode(tvShowDetailed),
].join('\n')
