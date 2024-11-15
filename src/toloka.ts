import puppeteer from 'puppeteer'

export const searchToloka = async (query: string) => {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto('https://toloka.to/login.php')
  await page.type('form[name=login] input[name=username]', process.env.TOLOKA_USERNAME)
  await page.type('form[name=login] input[name=password]', process.env.TOLOKA_PASSWORD)
  await page.click('form[name=login] input[name=login]')
  await page.waitForNavigation()
  await page.goto(`https://toloka.to/tracker.php?prev_sd=0&prev_a=0&prev_my=0&prev_n=0&prev_shc=0&prev_shf=1&prev_sha=1&prev_cg=0&prev_ct=0&prev_at=0&prev_nt=0&prev_de=0&prev_nd=0&prev_tcs=1&prev_shs=0&f%5B%5D=-1&o=10&s=2&tm=-1&shf=1&sha=1&tcs=1&sns=-1&sds=-1&nm=${query}&pn=&send=%D0%9F%D0%BE%D1%88%D1%83%D0%BA`)
  const results = await page.$$eval('.topictitle a', elements =>
    elements.map(el => ({
      title: el.innerText,
      url: el.closest('tr')!.querySelector('a[href^="download.php"]')!.href
    }))
  )
  console.log(results)
  await browser.close()
}
