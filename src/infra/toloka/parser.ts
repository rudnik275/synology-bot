import * as cheerio from 'cheerio'
import type { TolokaResult } from './types.ts'

const SIZE_RE = /\d+(?:[.,]\d+)?\s*(?:[KMGT]i?B|B)\b/i

/**
 * Parses a Toloka (Hurtom) tracker search-results page into TolokaResult[].
 *
 * Real markup (verified live): each result is a <tr> with class-tagged cells —
 * `td.topictitle` (title link), an `a[href^="download.php"]` link (the .torrent),
 * `td.seedmed` / `td.leechmed` (seeders/leechers), and a `td.gensmall` holding the
 * size. Selectors are class-based, not column-index based, so layout shuffles
 * don't silently break parsing. Tolerant: skips rows it can't fully parse.
 */
export function parseSearchPage(html: string, baseUrl: string): TolokaResult[] {
  const $ = cheerio.load(html)
  const results: TolokaResult[] = []

  $('tr').each((_i, row) => {
    try {
      const $row = $(row)

      // Match only genuine result rows: exactly one title cell. Outer/wrapper
      // <tr>s contain many `td.topictitle` (one per result) — without this guard
      // their `.find()` aggregates every row's cells (e.g. all seeders concatenated
      // into one giant number), producing a garbage phantom result.
      const titleCells = $row.find('td.topictitle')
      if (titleCells.length !== 1) return

      // A real result row always has a download.php link; bail early otherwise.
      const downloadEl = $row.find('a[href^="download.php"]')
      if (!downloadEl.length) return

      const downloadHref = downloadEl.attr('href') ?? ''
      const id = downloadHref.match(/[?&]id=(\d+)/)?.[1] ?? ''
      if (!id) return

      const title = titleCells.text().trim()
      if (!title) return

      const downloadUrl = `${baseUrl}/${downloadHref}`
      const category = $row.find('a[href^="tracker.php?f="]').first().text().trim()
      const size = $row
        .find('td.gensmall')
        .filter((_j, el) => SIZE_RE.test($(el).text()))
        .first()
        .text()
        .trim()
      const seeders = parseInt($row.find('td.seedmed').text().trim(), 10) || 0
      const leechers = parseInt($row.find('td.leechmed').text().trim(), 10) || 0

      results.push({ id, title, downloadUrl, size, seeders, leechers, category })
    } catch {
      // Skip malformed rows rather than failing the whole search.
    }
  })

  return results
}

/**
 * Parses a Toloka forum-topic page and returns the absolute URL of the first
 * `a[href^="download.php"]` anchor, or `null` if none is found.
 *
 * Topic pages embed the .torrent download link in a `download.php?id=` anchor
 * somewhere in the post body / controls row. The selector reuses the same
 * `a[href^="download.php"]` pattern proven in `parseSearchPage` (search-result
 * rows always contain this link). Resolves the relative href against `baseUrl`
 * exactly as `parseSearchPage` does.
 */
export function parseTopicPage(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)
  const anchor = $('a[href^="download.php"]').first()
  const href = anchor.attr('href')
  if (!href) return null
  return `${baseUrl.replace(/\/$/, '')}/${href}`
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
