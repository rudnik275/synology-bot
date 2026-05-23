/**
 * Manual smoke test for the Playwright fallback path.
 * NOT run in CI. Execute by hand to verify Playwright/Chromium is available.
 *
 * Usage:
 *   bun scripts/manual-playwright-smoke.ts
 *
 * What it tests:
 * 1. Dynamic import of Playwright succeeds (Chromium is installed)
 * 2. Browser launches headless, navigates to about:blank, then closes cleanly
 * 3. Optionally: playwrightFallback() invocation against the real site
 *    (requires TOLOKA_USERNAME + TOLOKA_PASSWORD to be set in the environment)
 */

console.log('[smoke] Starting Playwright smoke test...')

// Step 1: Dynamic import (verifies Chromium is installed)
console.log('[smoke] Step 1: Dynamic import of playwright...')
const { chromium } = await import('playwright')
console.log('[smoke] ✓ playwright imported successfully')

// Step 2: Launch + navigate + close
console.log('[smoke] Step 2: Launch browser, navigate to about:blank, close...')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  const title = await page.title()
  console.log(`[smoke] ✓ page.title() = "${title}"`)
  await page.close()
} finally {
  await browser.close()
  console.log('[smoke] ✓ Browser closed cleanly')
}

// Step 3: Optional real Toloka search (only if credentials provided)
const username = process.env['TOLOKA_USERNAME']
const password = process.env['TOLOKA_PASSWORD']
const baseUrl = process.env['TOLOKA_BASE_URL'] ?? 'https://toloka.to'

if (username && password) {
  console.log('[smoke] Step 3: Running playwrightFallback() against real Toloka site...')
  const { playwrightFallback } = await import('../src/infra/toloka/playwright-fallback.ts')
  try {
    const { results } = await playwrightFallback('ubuntu', {
      baseUrl,
      username,
      password,
    })
    console.log(`[smoke] ✓ Got ${results.length} results from Playwright fallback`)
    if (results.length > 0) {
      console.log(`[smoke]   First result: "${results[0]!.title}" (${results[0]!.seeders} seeders)`)
    }
  } catch (err) {
    console.error('[smoke] ✗ Playwright fallback threw:', err)
    process.exit(1)
  }
} else {
  console.log('[smoke] Step 3: Skipped (TOLOKA_USERNAME / TOLOKA_PASSWORD not set)')
}

console.log('[smoke] All smoke tests passed.')
