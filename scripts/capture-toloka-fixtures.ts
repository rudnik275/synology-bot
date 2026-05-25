/**
 * capture-toloka-fixtures.ts
 *
 * One-shot script to capture real Toloka HTML pages for use as test fixtures.
 * Run via: ./scripts/with-secrets.sh bun run scripts/capture-toloka-fixtures.ts
 *
 * Requires env vars: TOLOKA_USERNAME, TOLOKA_PASSWORD
 * Optional: TOLOKA_BASE_URL (default: https://toloka.to)
 * Optional: TOLOKA_SEARCH_QUERY (default: ubuntu)
 *
 * Captures:
 *   tests/fixtures/toloka/login.html         — the login form page (before auth)
 *   tests/fixtures/toloka/search-results.html — search results page (after auth)
 *   tests/fixtures/toloka/search-empty.html   — empty results page (with a nonsense query)
 *
 * Idempotent: re-running overwrites existing fixtures.
 * Captured on: 2026-05-23
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env['TOLOKA_BASE_URL'] ?? 'https://toloka.to'
const USERNAME = process.env['TOLOKA_USERNAME']
const PASSWORD = process.env['TOLOKA_PASSWORD']
const SEARCH_QUERY = process.env['TOLOKA_SEARCH_QUERY'] ?? 'ubuntu'
const EMPTY_QUERY = `xyzzy_no_results_${Date.now()}`

const FIXTURES_DIR = join(import.meta.dir, '../tests/fixtures/toloka')

if (!USERNAME || !PASSWORD) {
  console.error('Error: TOLOKA_USERNAME and TOLOKA_PASSWORD env vars are required')
  process.exit(1)
}

mkdirSync(FIXTURES_DIR, { recursive: true })

// -------------------------------------------------------------------------
// 1. Capture login form page (unauthenticated GET)
// -------------------------------------------------------------------------
console.log(`Capturing login page from ${BASE_URL}/login.php ...`)
const loginRes = await fetch(`${BASE_URL}/login.php`)
const loginHtml = await loginRes.text()
writeFileSync(join(FIXTURES_DIR, 'login.html'), loginHtml, 'utf-8')
console.log('  → saved login.html')

// -------------------------------------------------------------------------
// 2. Login to get session cookies
// -------------------------------------------------------------------------
console.log('Logging in...')
const loginBody = new URLSearchParams({
  entry: 'login',
  username: USERNAME,
  password: PASSWORD,
  autologin: 'on',
  ssl: 'on',
})

const cookies = new Map<string, string>()

const loginPostRes = await fetch(`${BASE_URL}/login.php`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: loginBody.toString(),
  redirect: 'manual',
})

loginPostRes.headers.forEach((value, key) => {
  if (key.toLowerCase() === 'set-cookie') {
    const parts = value.split(';')
    const nameValue = parts[0]?.trim()
    if (nameValue) {
      const eqIdx = nameValue.indexOf('=')
      if (eqIdx !== -1) {
        const name = nameValue.slice(0, eqIdx).trim()
        const val = nameValue.slice(eqIdx + 1).trim()
        if (name) cookies.set(name, val)
      }
    }
  }
})

if (cookies.size === 0) {
  console.error('Login failed: no cookies received. Check your credentials.')
  process.exit(1)
}

const cookieHeader = Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
console.log(`  → logged in, got ${cookies.size} cookies`)

// -------------------------------------------------------------------------
// 3. Capture search results page
// -------------------------------------------------------------------------
console.log(`Capturing search results for "${SEARCH_QUERY}"...`)
const searchUrl = `${BASE_URL}/tracker.php?nm=${encodeURIComponent(SEARCH_QUERY)}`
const searchRes = await fetch(searchUrl, {
  headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0 (compatible; synology-bot)' },
})
const searchHtml = await searchRes.text()
writeFileSync(join(FIXTURES_DIR, 'search-results.html'), searchHtml, 'utf-8')
console.log('  → saved search-results.html')

// -------------------------------------------------------------------------
// 4. Capture empty results page
// -------------------------------------------------------------------------
console.log(`Capturing empty results page for "${EMPTY_QUERY}"...`)
const emptyUrl = `${BASE_URL}/tracker.php?nm=${encodeURIComponent(EMPTY_QUERY)}`
const emptyRes = await fetch(emptyUrl, {
  headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0 (compatible; synology-bot)' },
})
const emptyHtml = await emptyRes.text()
writeFileSync(join(FIXTURES_DIR, 'search-empty.html'), emptyHtml, 'utf-8')
console.log('  → saved search-empty.html')

console.log('\nAll fixtures captured successfully:')
console.log(`  ${FIXTURES_DIR}/login.html`)
console.log(`  ${FIXTURES_DIR}/search-results.html`)
console.log(`  ${FIXTURES_DIR}/search-empty.html`)
console.log('\nNote: Commit with captured-on date in message so vintage is traceable.')
