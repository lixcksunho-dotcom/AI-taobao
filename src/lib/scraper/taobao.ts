import { chromium } from 'playwright'

export interface TaobaoProduct {
  taobao_id: string
  taobao_url: string
  title_cn: string
  price_cny: number
  images: string[]
  options: { type: string; values: string[] }[]
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]

function randomDelay(min = 1000, max = 3000) {
  return new Promise(r => setTimeout(r, Math.random() * (max - min) + min))
}

function extractItemId(url: string): string {
  const match = url.match(/id=(\d+)/)
  return match ? match[1] : url
}

export async function scrapeTaobaoProduct(url: string): Promise<TaobaoProduct> {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  }

  if (process.env.PROXY_SERVER) {
    launchOptions.proxy = {
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USER,
      password: process.env.PROXY_PASS,
    }
  }

  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })

  const page = await context.newPage()

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await randomDelay(2000, 4000)

    const title_cn = await page.$eval(
      '[data-spm="title"], .tb-main-title, h1',
      (el: Element) => el.textContent?.trim() ?? ''
    ).catch(() => '')

    const price_cny = await page.$eval(
      '.tb-rmb-num, .price, [class*="price"]',
      (el: Element) => parseFloat(el.textContent?.replace(/[^\d.]/g, '') ?? '0')
    ).catch(() => 0)

    const images = await page.$$eval(
      '.tb-thumb img, .shopTopImage img, [class*="thumb"] img',
      (imgs: Element[]) => [...new Set(
        (imgs as HTMLImageElement[])
          .map(img => img.src || img.dataset.src || '')
          .filter(src => src.startsWith('http'))
          .map(src => src.replace(/\.jpg_\d+x\d+\.jpg/, '.jpg'))
      )]
    ).catch(() => [] as string[])

    const options = await page.$$eval(
      '[class*="sku-item"], [class*="prop-item"]',
      (groups: Element[]) => groups.map(group => ({
        type: group.querySelector('[class*="title"], dt')?.textContent?.trim() ?? '',
        values: [...group.querySelectorAll('[class*="item"], dd')]
          .map(v => v.textContent?.trim() ?? '')
          .filter(Boolean),
      })).filter(g => g.type && g.values.length > 0)
    ).catch(() => [] as { type: string; values: string[] }[])

    return {
      taobao_id: extractItemId(url),
      taobao_url: url,
      title_cn,
      price_cny,
      images,
      options,
    }
  } finally {
    await browser.close()
  }
}
