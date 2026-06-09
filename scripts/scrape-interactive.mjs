/**
 * 대화형 대량 스크래핑 (로그인 → 캡차 해결 → 자동 수집)
 *
 * 사용법: node scripts/scrape-interactive.mjs [키워드] [페이지수] [소스]
 * 예시:   node scripts/scrape-interactive.mjs "连衣裙" 10 1688
 */

import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const dir = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const p = resolve(dir, '..', '.env.local')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf-8').split('\n')
      .map(l => l.match(/^([^#=]+)=(.*)$/))
      .filter(Boolean)
      .map(m => [m[1].trim(), m[2].trim()])
  )
}
const env = loadEnv()

const [,, KEYWORD = '连衣裙', PAGES_STR = '5', SOURCE = '1688'] = process.argv
const PAGES = parseInt(PAGES_STR, 10)

const PROFILE = resolve(dir, '..', '.chrome-profile')
const CHROME  = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
mkdirSync(PROFILE, { recursive: true })

const RATE   = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const MARGIN = parseFloat(env.MARGIN_RATE ?? '1.3')
const calcKrw = (cny) => Math.ceil(cny * RATE * MARGIN / 100) * 100

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

function searchUrl(keyword, page) {
  if (SOURCE === 'taobao')
    return `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}&s=${(page-1)*44}`
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}&beginPage=${page}`
}

/** 페이지에 실제 상품 데이터가 있는지 확인 */
async function hasSearchResults(page, source) {
  return page.evaluate((src) => {
    const scripts = Array.from(document.querySelectorAll('script'))
    for (const s of scripts) {
      const t = s.textContent ?? ''
      if (src === '1688' && (t.includes('offerList') || t.includes('"subject"'))) return true
      if (src === 'taobao' && (t.includes('g_page_config') || t.includes('auctions') || t.includes('__INIT_DATA__'))) return true
    }
    const items = document.querySelectorAll('[class*="offer-item"], [class*="offerItem"], [class*="item-cell"]')
    return items.length > 3
  }, source)
}

/** 페이지에서 상품 추출 */
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
    source,
    scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'taobao_id' })
    .select('id')

  if (error) { console.log('DB 오류:', error.message); return 0 }
  return data?.length ?? rows.length
}

// ──────────────────────────────────
// 메인
// ──────────────────────────────────
const rl = readline.createInterface({ input, output })

console.log('\n' + '═'.repeat(54))
console.log(` 키워드: ${KEYWORD}  |  페이지: ${PAGES}  |  소스: ${SOURCE}`)
console.log('═'.repeat(54))

const browser = await chromium.launchPersistentContext(PROFILE, {
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  headless: false,
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  locale: 'zh-CN',
})

const page = await browser.newPage()
await page.addInitScript(`
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
  window.chrome={runtime:{}};
`)

// ── STEP 1: 로그인 확인 ──
const loginUrl = SOURCE === 'taobao'
  ? 'https://login.taobao.com'
  : 'https://login.1688.com/member/signin.htm'

await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))

console.log('\n┌────────────────────────────────────────────────────┐')
console.log(`│  Chrome 창에서 ${SOURCE} 로그인을 완료하세요         │`)
console.log('│  로그인 완료 후 아래에서 Enter 를 누르세요          │')
console.log('└────────────────────────────────────────────────────┘')

await rl.question('\n  >> 로그인 완료 후 [Enter] 키를 누르세요: ')
rl.close()

console.log('\n✓ 로그인 확인. 수집 시작!\n')

// ── STEP 2: 페이지별 수집 ──
let totalSaved = 0
let consecutiveFail = 0

for (let p = 1; p <= PAGES; p++) {
  const url = searchUrl(KEYWORD, p)
  process.stdout.write(`[${p}/${PAGES}] 로딩 중... `)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500))

    // 상품 데이터 확인
    let ready = await hasSearchResults(page, SOURCE)

    if (!ready) {
      const title = await page.title().catch(() => '')
      const currentUrl = page.url()
      const blocked = currentUrl.includes('punish') || currentUrl.includes('captcha')
        || title.includes('验证') || title.includes('拦截')

      if (blocked) {
        console.log('\n  ⚠ 캡차 감지 — Chrome 창에서 직접 해결하세요 (최대 5분)')
        // 상품 데이터가 나타날 때까지 대기
        ready = await page.waitForFunction(
          (src) => {
            const scripts = Array.from(document.querySelectorAll('script'))
            for (const s of scripts) {
              const t = s.textContent ?? ''
              if (src === '1688' && (t.includes('offerList') || t.includes('"subject"'))) return true
              if (src === 'taobao' && (t.includes('g_page_config') || t.includes('auctions'))) return true
            }
            return document.querySelectorAll('[class*="offer-item"],[class*="offerItem"]').length > 3
          },
          SOURCE,
          { timeout: 300_000, polling: 2000 }
        ).then(() => true).catch(() => {
          console.log('  타임아웃 — 다음 페이지로')
          return false
        })
        if (ready) process.stdout.write('  캡차 해결됨! ')
      } else {
        process.stdout.write(`(데이터 없음 / title: ${title.slice(0,30)}) `)
        consecutiveFail++
        if (consecutiveFail >= 3) {
          console.log('\n3페이지 연속 실패 — 세션 문제. 종료합니다.')
          break
        }
        continue
      }
    }

    if (!ready) { consecutiveFail++; continue }
    consecutiveFail = 0

    // 상품 추출
    const products = await extractProducts(page, SOURCE)
    process.stdout.write(`${products.length}개 수집 `)

    if (products.length === 0) {
      console.log('→ 파싱 실패 (스킵)')
      continue
    }

    // DB 저장
    const saved = await saveToDb(products, SOURCE)
    totalSaved += saved
    console.log(`→ 저장 ${saved}개  (누적 ${totalSaved}개)`)

    if (p < PAGES) await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))

  } catch (err) {
    console.log(`→ 오류: ${err.message.slice(0, 80)}`)
  }
}

console.log('\n' + '═'.repeat(54))
console.log(` 완료!  총 ${totalSaved}개 상품 DB 저장됨`)
console.log('═'.repeat(54) + '\n')

await browser.close()
