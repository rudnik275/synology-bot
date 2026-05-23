import type { TolokaResult } from './types.ts'
import { parseSearchPage, isLoginPage } from './parser.ts'

export interface PlaywrightFallbackOptions {
  baseUrl: string
  username: string
  password: string
  /** Serialized cookie string (e.g. 'PHPSESSID=abc; bb_session=xyz') */
  cookie?: string
  userAgent?: string
}

export interface PlaywrightFallbackResult {
  results: TolokaResult[]
  /** Updated cookie string to persist back to the session store */
  newCookie?: string
}

/**
 * Playwright-based fallback for Toloka search when HTTP fails.
 * Dynamically imports Playwright (chromium) so it is NOT loaded on bot cold start.
 *
 * Returns parsed search results and an updated cookie string.
 * Throws with a descriptive reason if the search cannot be completed.
 */
export async function playwrightFallback(
  query: string,
  opts: PlaywrightFallbackOptions
): Promise<PlaywrightFallbackResult> {
  // Dynamic import — Chromium is NOT loaded unless this function is actually called.
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      userAgent: opts.userAgent,
      extraHTTPHeaders: {},
    })

    // Inject existing cookies if available
    if (opts.cookie) {
      const cookies = parseCookieString(opts.cookie, opts.baseUrl)
      if (cookies.length > 0) {
        await context.addCookies(cookies)
      }
    }

    const page = await context.newPage()

    const searchUrl = `${opts.baseUrl}/tracker.php?nm=${encodeURIComponent(query)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })

    // If redirected to login page, log in first
    const contentAfterNav = await page.content()
    if (isLoginPage(contentAfterNav)) {
      await fillLoginForm(page, opts.username, opts.password)
      // Navigate to search again after login
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })

      const contentAfterLogin = await page.content()
      if (isLoginPage(contentAfterLogin)) {
        throw new Error('Toloka Playwright fallback: login failed (still on login page after submit)')
      }
    }

    // Wait for results table to render
    await page.waitForSelector('.tbl-results, table.forumline', { timeout: 15000 })

    const html = await page.content()
    const results = parseSearchPage(html, opts.baseUrl)

    // Capture updated cookies to persist back
    const updatedCookies = await context.cookies()
    const newCookie = updatedCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    return { results, newCookie: newCookie || undefined }
  } finally {
    await browser.close()
  }
}

/**
 * Fills the Toloka login form and submits it.
 */
async function fillLoginForm(
  page: import('playwright').Page,
  username: string,
  password: string
): Promise<void> {
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.click('input[type="submit"], button[type="submit"]')
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {
    // Navigation may not fire if already on the correct page
  })
}

/**
 * Converts a serialized cookie string into Playwright cookie objects for a given URL.
 */
function parseCookieString(
  cookieStr: string,
  baseUrl: string
): Array<{ name: string; value: string; domain: string; path: string }> {
  let domain: string
  try {
    domain = new URL(baseUrl).hostname
  } catch {
    domain = baseUrl
  }

  return cookieStr
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf('=')
      if (eqIdx === -1) return null
      const name = part.slice(0, eqIdx).trim()
      const value = part.slice(eqIdx + 1).trim()
      return name ? { name, value, domain, path: '/' } : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
}
