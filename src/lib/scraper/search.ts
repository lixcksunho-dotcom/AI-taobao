import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const CHROME_PROFILE = resolve(process.cwd(), '.chrome-profile')
const CHROME_EXE     = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export interface SearchProduct {
  taobao_id: string
  taobao_url: string
  title_cn: string
  price_cny: number
  images: string[]
  options: []
  source: 'taobao' | '1688'
}

function randomDelay(min = 2000, max = 4500) {
  return new Promise(r => setTimeout(r, Math.random() * (max - min) + min))
}

// 실제 Chrome + 봇 감지 우회 스크립트
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','zh','en'] });
  window.chrome = { runtime: {} };
  const orig = navigator.permissions.query;
  navigator.permissions.query = (p) =>
    p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : orig.call(navigator.permissions, p);
`

function makeContext(headless = true) {
  mkdirSync(CHROME_PROFILE, { recursive: true })
  return chromium.launchPersistentContext(CHROME_PROFILE, {
    executablePath: existsSync(CHROME_EXE) ? CHROME_EXE : undefined,
    headless,
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    locale: 'zh-CN',
    ...(process.env.PROXY_SERVER ? {
      proxy: {
        server:   process.env.PROXY_SERVER,
        username: process.env.PROXY_USER,
        password: process.env.PROXY_PASS,
      }
    } : {}),
  })
}

// ─────────────────────────────────────────────
// 타오바오 검색
// ─────────────────────────────────────────────
export async function scrapeTaobaoSearch(keyword: string, page = 1): Promise<SearchProduct[]> {
  const offset    = (page - 1) * 44
  const searchUrl = `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}&s=${offset}&sort=default`

  const context = await makeContext(true)
  const pageObj = await context.newPage()
  await pageObj.addInitScript(STEALTH_SCRIPT)

  try {
    await pageObj.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await randomDelay(2500, 4000)

    const currentUrl = pageObj.url()
    if (currentUrl.includes('punish') || currentUrl.includes('captcha') || currentUrl.includes('login')) {
      console.error('[taobao] 차단/로그인 요구 →', currentUrl)
      return []
    }

    const products = await pageObj.evaluate(() => {
      try {
        for (const s of Array.from(document.querySelectorAll('script'))) {
          const t = s.textContent ?? ''
          if (t.includes('g_page_config') && t.includes('auctions')) {
            const m = t.match(/g_page_config\s*=\s*(\{[\s\S]*?\});\s*(?:window|var|$)/)
            if (m) {
              const list = JSON.parse(m[1])?.mods?.itemlist?.data?.auctions ?? []
              if (list.length) return list.map((a: Record<string, string>) => ({
                nid: a.nid, title: a.raw_title ?? a.title ?? '',
                price: parseFloat(a.view_price ?? a.price ?? '0'),
                pic: a.pic_url ? 'https:' + a.pic_url : '',
              }))
            }
          }
          if (t.includes('__INIT_DATA__')) {
            const m = t.match(/__INIT_DATA__\s*=\s*(\{[\s\S]*?\});/)
            if (m) {
              const d = JSON.parse(m[1])
              const list = d?.data?.itemsArray ?? d?.itemList?.data ?? d?.mods?.itemlist?.data?.auctions ?? []
              if (list.length) return list.map((a: Record<string, unknown>) => ({
                nid: a.nid ?? a.itemId,
                title: a.title ?? a.name ?? a.raw_title ?? '',
                price: parseFloat(String(a.price ?? a.priceWap ?? a.view_price ?? '0')),
                pic: a.pic ? 'https:' + a.pic : (a.pic_url ? 'https:' + a.pic_url : ''),
              }))
            }
          }
        }
      } catch { /* ignore */ }
      return []
    })

    if (products.length === 0) {
      console.error('[taobao] 0개 — Title:', await pageObj.title(), '/ URL:', pageObj.url())
    }

    return products.map((p: { nid: unknown; title: string; price: number; pic: string }) => ({
      taobao_id: String(p.nid),
      taobao_url: `https://item.taobao.com/item.htm?id=${p.nid}`,
      title_cn: p.title,
      price_cny: p.price,
      images: p.pic ? [p.pic.startsWith('//') ? 'https:' + p.pic : p.pic] : [],
      options: [] as [],
      source: 'taobao' as const,
    }))
  } finally {
    await context.close()
  }
}

// ─────────────────────────────────────────────
// 1688.com 검색
// ─────────────────────────────────────────────
export async function scrape1688Search(keyword: string, page = 1): Promise<SearchProduct[]> {
  const searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}&beginPage=${page}`

  const context = await makeContext(true)
  const pageObj = await context.newPage()
  await pageObj.addInitScript(STEALTH_SCRIPT)

  try {
    await pageObj.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await randomDelay(2000, 3500)

    const jsonProducts = await pageObj.evaluate(() => {
      try {
        for (const s of Array.from(document.querySelectorAll('script'))) {
          const t = s.textContent ?? ''
          if (t.includes('offerList') || t.includes('__GLOBAL_DATA__')) {
            const m = t.match(/window\.__GLOBAL_DATA__\s*=\s*(\{[\s\S]*?\});/)
              ?? t.match(/offerList\s*:\s*(\[[\s\S]*?\])\s*,/)
            if (m) {
              const raw = JSON.parse(m[1])
              const list = raw?.offerList ?? raw?.data?.offerList ?? (Array.isArray(raw) ? raw : [])
              if (list.length) return list.map((o: Record<string, unknown>) => {
                const pi = o.priceInfo as Record<string, unknown> | undefined
                const img = o.image as Record<string, unknown> | undefined
                return {
                  id: o.offerId ?? o.id,
                  title: o.subject ?? o.title ?? '',
                  price: parseFloat(String(pi?.price ?? o.price ?? '0')),
                  pic: String(img?.imgUrl ?? o.imgUrl ?? ''),
                }
              })
            }
          }
        }
      } catch { /* ignore */ }
      return []
    })

    if (jsonProducts.length === 0) {
      const htmlProducts = await pageObj.$$eval(
        '.offer-list-row .offer-item, [class*="offerItem"]',
        (els: Element[]) => els.map(el => {
          const link = el.querySelector('a[href*="detail.1688"]') as HTMLAnchorElement | null
          const id   = link?.href.match(/offer\/(\d+)/)?.[1] ?? ''
          return {
            id,
            title: el.querySelector('[class*="title"],h4')?.textContent?.trim() ?? '',
            price: parseFloat(el.querySelector('[class*="price"]')?.textContent?.replace(/[^\d.]/g, '') ?? '0'),
            pic: (el.querySelector('img') as HTMLImageElement | null)?.src ?? '',
          }
        }).filter(p => p.id)
      ).catch(() => [])
      return htmlProducts.map((p: { id: string; title: string; price: number; pic: string }) => ({
        taobao_id: `1688_${p.id}`, taobao_url: `https://detail.1688.com/offer/${p.id}.html`,
        title_cn: p.title, price_cny: p.price,
        images: p.pic ? [p.pic.startsWith('//') ? 'https:' + p.pic : p.pic] : [],
        options: [] as [], source: '1688' as const,
      }))
    }

    return jsonProducts.map((p: { id: unknown; title: string; price: number; pic: string }) => ({
      taobao_id: `1688_${p.id}`, taobao_url: `https://detail.1688.com/offer/${p.id}.html`,
      title_cn: p.title, price_cny: p.price,
      images: p.pic ? [p.pic.startsWith('//') ? 'https:' + p.pic : p.pic] : [],
      options: [] as [], source: '1688' as const,
    }))
  } finally {
    await context.close()
  }
}

export async function scrapeSearchPage(
  keyword: string,
  page = 1,
  source: 'taobao' | '1688' | 'auto' = 'auto'
): Promise<SearchProduct[]> {
  if (source === '1688') return scrape1688Search(keyword, page)
  if (source === 'taobao') return scrapeTaobaoSearch(keyword, page)
  const results = await scrapeTaobaoSearch(keyword, page)
  if (results.length > 0) return results
  console.log(`[auto] 타오바오 실패 → 1688 폴백`)
  return scrape1688Search(keyword, page)
}
