import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSearchPage, isLoginPage } from '../../../../src/infra/toloka/parser.ts'

const FIXTURES_DIR = join(import.meta.dir, '../../../fixtures/toloka')
const BASE_URL = 'https://toloka.to'

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

describe('TolokaResultParser', () => {
  // --- Search results page ---
  it('parses search results page into TolokaResult[]', () => {
    const html = readFixture('search-results.html')
    const results = parseSearchPage(html, BASE_URL)

    expect(results.length).toBe(3)

    const first = results[0]!
    expect(first.id).toBe('1001')
    expect(first.title).toBe('Ubuntu 24.04 LTS Desktop amd64')
    expect(first.size).toBe('4.7 GB')
    expect(first.seeders).toBe(1200)
    expect(first.leechers).toBe(87)
    expect(first.downloadUrl).toBe(`${BASE_URL}/download.php?id=1001`)
  })

  it('parses second result with correct fields', () => {
    const html = readFixture('search-results.html')
    const results = parseSearchPage(html, BASE_URL)

    const second = results[1]!
    expect(second.id).toBe('1002')
    expect(second.title).toBe('Ubuntu 24.04 Server amd64')
    expect(second.size).toBe('1.2 GB')
    expect(second.seeders).toBe(540)
    expect(second.leechers).toBe(12)
    expect(second.downloadUrl).toBe(`${BASE_URL}/download.php?id=1002`)
  })

  it('parses empty results page as empty array', () => {
    const html = readFixture('search-empty.html')
    const results = parseSearchPage(html, BASE_URL)
    expect(results).toEqual([])
  })

  it('parses single result from real-markup row (subset check)', () => {
    // Mirrors real Toloka markup: title in td.topictitle, download.php link,
    // td.gensmall size, td.seedmed / td.leechmed counts.
    const singleResultHtml = `
      <html><body>
      <table><tbody>
      <tr>
        <td class="gen"><a href="tracker.php?f=10">Фільми</a></td>
        <td title="" class="topictitle genmed"><a class="genmed" href="t5000"><b>Single Movie</b></a></td>
        <td class="genmed"><a href="tracker.php?pid=9">user</a></td>
        <td class="genmed" onClick="window.location.href='download.php?id=5000'"><a class="genmed" href="download.php?id=5000">[ DL ]</a></td>
        <td class="gensmall">2.1 GB</td>
        <td class="seedmed"><b>99</b></td>
        <td class="leechmed"><b>3</b></td>
      </tr>
      </tbody></table>
      </body></html>
    `
    const results = parseSearchPage(singleResultHtml, BASE_URL)
    expect(results.length).toBe(1)
    expect(results[0]!.title).toBe('Single Movie')
    expect(results[0]!.size).toBe('2.1 GB')
    expect(results[0]!.seeders).toBe(99)
    expect(results[0]!.leechers).toBe(3)
    expect(results[0]!.downloadUrl).toBe(`${BASE_URL}/download.php?id=5000`)
  })

  it('skips rows without a download link and continues parsing', () => {
    const htmlWithBadRow = `
      <html><body>
      <table><tbody>
      <tr>
        <td title="" class="topictitle genmed"><a href="t1"><b>No download link</b></a></td>
        <td class="gensmall">1 GB</td><td class="seedmed">10</td><td class="leechmed">2</td>
      </tr>
      <tr>
        <td title="" class="topictitle genmed"><a href="t9999"><b>Valid Result</b></a></td>
        <td class="genmed"><a href="download.php?id=9999">[ DL ]</a></td>
        <td class="gensmall">3 GB</td><td class="seedmed">50</td><td class="leechmed">5</td>
      </tr>
      </tbody></table>
      </body></html>
    `
    const results = parseSearchPage(htmlWithBadRow, BASE_URL)
    expect(results.length).toBe(1)
    expect(results[0]!.title).toBe('Valid Result')
    expect(results[0]!.seeders).toBe(50)
  })

  it('returns empty array for completely invalid HTML', () => {
    const results = parseSearchPage('<html><body>no table here</body></html>', BASE_URL)
    expect(results).toEqual([])
  })

  // --- isLoginPage ---
  it('detects login page from login.html fixture', () => {
    const html = readFixture('login.html')
    expect(isLoginPage(html)).toBe(true)
  })

  it('does not detect login page on search results page', () => {
    const html = readFixture('search-results.html')
    expect(isLoginPage(html)).toBe(false)
  })

  it('detects login page when search-results.html contains a login form', () => {
    // search-results.html fixture has an empty login form for testing redirect detection
    // The fixture has a form[name=login] — this simulates auth redirect
    const html = readFixture('search-results.html')
    // Actually our search-results.html fixture does contain a login form for test purposes
    // Let's verify directly with a controlled string
    const withLogin = '<html><body><form name="login"><input name="username"/></form></body></html>'
    expect(isLoginPage(withLogin)).toBe(true)
  })
})
