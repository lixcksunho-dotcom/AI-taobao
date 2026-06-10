/**
 * 무인 대량 스크래핑 — 저장된 세션 재사용, Enter/캡차 입력 없이 headless 수집
 *
 * 전제: 먼저 한 번 `node scripts/session-login.mjs <source>` 로 로그인해 둘 것.
 *       세션은 .chrome-profile/ 에 저장돼 수 주간 유지된다.
 *
 * 사용법:
 *   node scripts/scrape-auto.mjs "连衣裙" 5 1688
 *   node scripts/scrape-auto.mjs "包包" 3 taobao
 *
 * 종료코드: 0=수집성공, 2=DB/설정오류, 3=세션만료·캡차(재로그인 필요)
 */

import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

chromium.use(StealthPlugin())

const dir = dirname(fileURLToPath(import.meta.url))

// ── .env.local ──────────────────────────────────────────────
function loadEnv() {
  const p = resolve(dir, '..', '.env.local')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf-8').split('\n')
      .map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1].trim(), m[2].trim()])
  )
}
const env = loadEnv()
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env.local에 Supabase URL / SERVICE_ROLE_KEY가 없습니다.')
  process.exit(2)
}

const [,, KEYWORD = '连衣裙', PAGES_STR = '5', SOURCE = '1688'] = process.argv
const PAGES = parseInt(PAGES_STR, 10)
if (!['taobao', '1688'].includes(SOURCE)) {
  console.error(`❌ 소스는 taobao 또는 1688 이어야 합니다. (입력: ${SOURCE})`)
  process.exit(2)
}

const PROFILE = resolve(dir, '..', '.chrome-profile')
if (!existsSync(PROFILE)) {
  console.error('❌ .chrome-profile 이 없습니다. 먼저 로그인하세요:')
  console.error(`   node scripts/session-login.mjs ${SOURCE}`)
  process.exit(3)
}
mkdirSync(PROFILE, { recursive: true })

const RATE   = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const MARGIN = parseFloat(env.MARGIN_RATE ?? '1.3')
const calcKrw = (cny) => Math.ceil(cny * RATE * MARGIN / 100) * 100

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const searchUrl = (kw, p) => SOURCE === 'taobao'
  ? `https://s.taobao.com/search?q=${encodeURIComponent(kw)}&s=${(p - 1) * 44}`
  : `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&beginPage=${p}`

function isBlocked(url, title) {
  return /punish|captcha|login\./.test(url) || /验证|拦截|登录/.test(title)
}

// 페이지에서 상품 추출 (scrape-interactive.mjs 와 동일 로직)
async function extractProducts(page, source) {
  const json = await page.evaluate((src) => {
    try {
      for (const s of Array.from(document.querySelectorAll('script'))) {
        const t = s.textContent ?? ''
        if (src === 'taobao') {
          if (t.includes('g_page_config') && t.includes('auctions')) {
            const m = t.match(/g_page_config\s*=\s*(\{[\s\S]*?\});\s*(?:window|var)/)
            if (m) {
              const list = JSON.parse(m[1])?.mods?.itemlist?.data?.auctions ?? []
              if (list.length) return list.map(a => ({
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
              const list = d?.data?.itemsArray ?? d?.mods?.itemlist?.data?.auctions ?? []
              if (list.length) return list.map(a => ({
                nid: a.nid ?? a.itemId, title: a.title ?? a.raw_title ?? '',
                price: parseFloat(String(a.price ?? a.view_price ?? '0')),
                pic: a.pic ? 'https:' + a.pic : (a.pic_url ? 'https:' + a.pic_url : ''),
              }))
            }
          }
        } else {
          if (t.includes('offerList') || t.includes('__GLOBAL_DATA__')) {
            const m = t.match(/window\.__GLOBAL_DATA__\s*=\s*(\{[\s\S]*?\});/)
              ?? t.match(/offerList\s*:\s*(\[[\s\S]*?\]),/)
            if (m) {
              const raw = JSON.parse(m[1])
              const list = raw?.offerList ?? raw?.data?.offerList ?? (Array.isArray(raw) ? raw : [])
              if (list.length) return list.map(o => ({
                nid: '1688_' + (o.offerId ?? o.id),
                title: o.subject ?? o.title ?? '',
                price: parseFloat(String(o.priceInfo?.price ?? o.price ?? '0')),
                pic: String(o.image?.imgUrl ?? o.imgUrl ?? ''),
              }))
            }
          }
        }
      }
    } catch { /* ignore */ }
    return []
  }, source)

  if (json.length > 0) return json

  if (source === '1688') {
    return page.$$eval(
      '.offer-list-row .offer-item, [class*="offerItem"]',
      els => els.map(el => {
        const link = el.querySelector('a[href*="detail.1688"]')
        const id = link?.href.match(/offer\/(\d+)/)?.[1] ?? ''
        return {
          nid: '1688_' + id,
          title: el.querySelector('[class*="title"],h4')?.textContent?.trim() ?? '',
          price: parseFloat(el.querySelector('[class*="price"]')?.textContent?.replace(/[^\d.]/g, '') ?? '0'),
          pic: el.querySelector('img')?.src ?? '',
        }
      }).filter(p => p.nid !== '1688_')
    ).catch(() => [])
  }
  return []
}

async function saveToDb(products, source) {
  const rows = products.map(pr => ({
    taobao_id: pr.nid,
    taobao_url: source === 'taobao'
      ? `https://item.taobao.com/item.htm?id=${pr.nid}`
      : `https://detail.1688.com/offer/${pr.nid.replace('1688_', '')}.html`,
    title_cn: pr.title,
    title_kr: null,
    price_cny: pr.price,
    price_krw: calcKrw(pr.price),
    images: pr.pic ? [pr.pic.startsWith('//') ? 'https:' + pr.pic : pr.pic] : [],
    options: [],
    stock_status: 'available',
    scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))
  const { data, error } = await sb.from('products').upsert(rows, { onConflict: 'taobao_id' }).select('id')
  if (error) { console.log('  DB 오류:', error.message); return 0 }
  return data?.length ?? rows.length
}

// ── 메인 ────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(56))
console.log(` 무인 수집  |  ${KEYWORD}  |  ${PAGES}p  |  ${SOURCE}`)
console.log('═'.repeat(56))

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  locale: 'zh-CN',
  ...(env.PROXY_SERVER ? { proxy: { server: env.PROXY_SERVER, username: env.PROXY_USER, password: env.PROXY_PASS } } : {}),
})
const page = await context.newPage()

let totalSaved = 0, consecutiveEmpty = 0, sessionDead = false

for (let p = 1; p <= PAGES; p++) {
  process.stdout.write(`[${p}/${PAGES}] `)
  try {
    await page.goto(searchUrl(KEYWORD, p), { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 2500 + Math.random() * 2000))

    const title = await page.title().catch(() => '')
    if (isBlocked(page.url(), title)) {
      console.log(`⛔ 세션 만료/캡차 감지 (title: ${title.slice(0, 20)})`)
      sessionDead = true
      break
    }

    const products = await extractProducts(page, SOURCE)
    if (products.length === 0) {
      console.log('0개 (파싱 실패/빈 페이지)')
      if (++consecutiveEmpty >= 3) { console.log('3p 연속 빈 결과 — 종료'); break }
      continue
    }
    consecutiveEmpty = 0

    const saved = await saveToDb(products, SOURCE)
    totalSaved += saved
    console.log(`${products.length}개 수집 → 저장 ${saved} (누적 ${totalSaved})`)

    if (p < PAGES) await new Promise(r => setTimeout(r, 2000 + Math.random() * 2500))
  } catch (err) {
    console.log(`오류: ${String(err.message).slice(0, 70)}`)
  }
}

await context.close()

console.log('═'.repeat(56))
if (sessionDead) {
  console.log(` ⛔ 세션이 만료됐습니다. 재로그인 후 다시 실행하세요:`)
  console.log(`    node scripts/session-login.mjs ${SOURCE}`)
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 3
} else {
  console.log(` ✅ 완료! 총 ${totalSaved}개 저장`)
  console.log(`    검증: node scripts/verify-collection.mjs --since 30`)
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 0
}
// Windows + undici keep-alive 환경에서 깔끔히 종료
setTimeout(() => process.exit(process.exitCode), 300)
