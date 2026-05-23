export interface TolokaResult {
  id: string
  title: string
  downloadUrl: string // absolute URL to .torrent
  size: string        // human-readable, e.g. "4.7 GB"
  seeders: number
  leechers: number
  category: string
}

export interface TolokaClientConfig {
  username: string
  password: string
  baseUrl: string
}
