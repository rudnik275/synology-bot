import type {Browser, Page} from 'playwright'
import {chromium} from 'playwright'

const login = async (): Promise<[Browser, Page]> => {
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage()
  await page.goto('https://toloka.to/login.php')
  await page.fill('form[name=login] input[name=username]', process.env.TOLOKA_USERNAME!)
  await page.fill('form[name=login] input[name=password]', process.env.TOLOKA_PASSWORD!)
  await page.click('form[name=login] input[name=login]')
  return [browser, page]
}

export const downloadTorrent = async (link: string): Promise<ReadableStream<Uint8Array>> => {
  const [browser, page] = await login()
  const cookies = await page.context().cookies()
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const response = await fetch(link, {headers: {Cookie: cookieHeader}})
  await browser.close()
  return response.body!
}

export const searchToloka = async (query: string): Promise<{ title: string; url: string }[]> => {
  const [browser, page] = await login()
  await page.goto(`https://toloka.to/tracker.php?prev_sd=0&prev_a=0&prev_my=0&prev_n=0&prev_shc=0&prev_shf=1&prev_sha=1&prev_cg=0&prev_ct=0&prev_at=0&prev_nt=0&prev_de=0&prev_nd=0&prev_tcs=1&prev_shs=0&f%5B%5D=-1&o=10&s=2&tm=-1&shf=1&sha=1&tcs=1&sns=-1&sds=-1&nm=${encodeURIComponent(query)}&pn=&send=%D0%9F%D0%BE%D1%88%D1%83%D0%BA`)
  const results = await page.$$eval('.topictitle a', elements =>
    elements.map(el => {
      const title = el.textContent || ''
      const parent = el.closest('tr')
      const downloadLink = parent?.querySelector<HTMLAnchorElement>('a[href^="download.php"]')
      return {
        title,
        url: downloadLink?.href || ''
      }
    }).filter(result => result.url !== '')
  )
  await browser.close()
  return results.slice(0, 6)
}
