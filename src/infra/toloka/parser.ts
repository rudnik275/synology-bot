import * as cheerio from 'cheerio'
import type { TolokaResult } from './types.ts'

/**
 * Parses Toloka tracker search results page HTML into TolokaResult[].
 * Tolerant parser: skips malformed rows rather than crashing.
 */
export function parseSearchPage(html: string, baseUrl: string): TolokaResult[] {
  const $ = cheerio.load(html)
  const results: TolokaResult[] = []

  // Each result row has a .topictitle link and a download.php link
  $('tr').each((_i, row) => {
    try {
      const $row = $(row)
      const titleEl = $row.find('a.topictitle')
      if (!titleEl.length) return

      const title = titleEl.text().trim()
      if (!title) return

      const downloadEl = $row.find('a[href^="download.php"]')
      if (!downloadEl.length) return

      const downloadHref = downloadEl.attr('href') ?? ''
      const idMatch = downloadHref.match(/[?&]id=(\d+)/)
      const id = idMatch?.[1] ?? ''
      if (!id) return

      const downloadUrl = `${baseUrl}/${downloadHref}`

      // Columns (1-indexed): category, author, title, replies, views, date, size, seeders, leechers, download
      const cells = $row.find('td')
      const category = cells.eq(0).text().trim()
      const size = cells.eq(6).text().trim()
      const seedersText = cells.eq(7).text().trim()
      const leechersText = cells.eq(8).text().trim()

      const seeders = parseInt(seedersText, 10) || 0
      const leechers = parseInt(leechersText, 10) || 0

      results.push({ id, title, downloadUrl, size, seeders, leechers, category })
    } catch {
      // Skip malformed rows
    }
  })

  return results
}

/**
 * Returns true if the HTML page contains a Toloka login form (auth required).
 */
export function isLoginPage(html: string): boolean {
  const $ = cheerio.load(html)
  return $('form[name="login"]').length > 0
}

/**
 * Returns true if the page shows an authenticated session. Toloka renders a
 * `login.php?logout=...` link ("Вихід [ user ]") only when logged in. A stale
 * session on tracker.php shows neither the login form nor this link — just an
 * empty results page — so this is the reliable "are we logged in?" signal.
 */
export function isAuthenticated(html: string): boolean {
  return html.includes('login.php?logout')
}
