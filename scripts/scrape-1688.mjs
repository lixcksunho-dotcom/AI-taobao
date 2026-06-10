/**
 * 1688 무인 수집 (2024 새 SPA 대응) — 검증된 mtop 파서 기반
 *
 * 동작:
 *   1) 저장된 세션으로 1688 홈 진입
 *   2) 검색창에 키워드 입력 → Enter (UI 흐름이라야 offer 응답이 채워짐)
 *   3) mtop.relationrecommend.wirelessrecommend.recommend 응답(.data.data.OFFER.items)
 *      을 가로채 parseSearchOffers 로 파싱 (페이지당 ~60건)
 *   4) DB(products) 저장
 *
 * 전제: node scripts/session-login.mjs 1688  으로 1회 로그인돼 있을 것.
 *
 * 사용법:
 *   node scripts/scrape-1688.mjs "连衣裙" [페이지수=1] [headed|headless]
 * 종료코드: 0=성공, 2=설정오류, 3=세션만료
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseSearchOffers } from './lib-1688.mjs'

chromium.use(StealthPlugin())
const dir = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const p = resolve(dir, '..', '.env.local')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf-8').split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()])
  )
}
const env = loadEnv()
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env.local 에 Supabase 설정이 없습니다.'); process.exit(2)
}

const [,, KEYWORD = '连衣裙', PAGES_STR = '1', MODE = 'headed'] = process.argv
const PAGES = Math.max(1, parseInt(PAGES_STR, 10) || 1)
const HEADLESS = MODE === 'headless'

const PROFILE = resolve(dir, '..', '.chrome-profile')
if (!existsSync(PROFILE)) {
  console.error('❌ .chrome-profile 없음. 먼저: node scripts/session-login.mjs 1688'); process.exit(3)
}
mkdirSync(PROFILE, { recursive: true })

const RATE = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const MARGIN = parseFloat(env.MARGIN_RATE ?? '1.3')
const calcKrw = (cny) => Math.ceil(cny * RATE * MARGIN / 100) * 100
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function saveToDb(offers) {
  const now = new Date().toISOString()
  const rows = offers.map(o => ({
    taobao_id: `1688_${o.id}`,
    taobao_url: o.url,
    title_cn: o.title,
    title_kr: null,
    price_cny: o.cny,
    price_krw: calcKrw(o.cny),
    images: o.img ? [o.img] : [],
    options: [],
    stock_status: 'available',
    scraped_at: now,
    updated_at: now,
  }))
  const { data, error } = await sb.from('products').upsert(rows, { onConflict: 'taobao_id' }).select('id')
  if (error) { console.log('  DB 오류:', error.message); return 0 }
  return data?.length ?? rows.length
}

console.log('\n' + '═'.repeat(56))
console.log(` 1688 수집 (새 SPA)  |  ${KEYWORD}  |  ${PAGES}p  |  ${HEADLESS ? 'headless' : 'headed'}`)
console.log('═'.repeat(56))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: HEADLESS, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
  ...(env.PROXY_SERVER ? { proxy: { server: env.PROXY_SERVER, username: env.PROXY_USER, password: env.PROXY_PASS } } : {}),
})

// offer 응답 누적 (id 기준 dedupe)
const collected = new Map()
let pagesSeen = 0
ctx.on('response', async (res) => {
  if (!/wirelessrecommend\.recommend/i.test(res.url())) return
  let body = ''
  try { body = await res.text() } catch { return }
  const mm = body.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/)
  let json; try { json = JSON.parse(mm ? mm[1] : body) } catch { return }
  const offers = parseSearchOffers(json)
  if (offers.length) {
    pagesSeen++
    let added = 0
    for (const o of offers) if (!collected.has(o.id)) { collected.set(o.id, o); added++ }
    console.log(`  [응답] offer ${offers.length}건 (신규 ${added}, 누적 ${collected.size})`)
  }
})

const page = await ctx.newPage()
let sessionDead = false

try {
  await page.goto('https://www.1688.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise(r => setTimeout(r, 2500))

  const title = await page.title().catch(() => '')
  if (/登录|login/i.test(page.url()) || /验证|拦截/.test(title)) {
    sessionDead = true
  } else {
    const box = await page.$('input[name="keywords"]') || await page.$('input[type="text"]')
    if (!box) throw new Error('검색창을 찾지 못함')
    await box.click(); await box.fill(KEYWORD)
    await new Promise(r => setTimeout(r, 500))
    await page.keyboard.press('Enter')

    // 1페이지 대기
    for (let i = 0; i < 12 && collected.size === 0; i++) await new Promise(r => setTimeout(r, 1500))

    // 추가 페이지: 페이저 '다음' 클릭 best-effort
    for (let p = 2; p <= PAGES; p++) {
      const before = collected.size
      const active = ctx.pages().at(-1)
      const clicked = await active.evaluate(() => {
        const cand = [...document.querySelectorAll('button,a,span,div')]
          .find(e => /下一页|下一頁|next/i.test((e.textContent || '').trim()) && (e.offsetParent !== null))
        if (cand) { cand.click(); return true }
        return false
      }).catch(() => false)
      if (!clicked) { console.log(`  (${p}p: 다음 버튼 없음 — 페이징 중단)`); break }
      for (let i = 0; i < 10 && collected.size === before; i++) await new Promise(r => setTimeout(r, 1500))
      if (collected.size === before) { console.log(`  (${p}p: 신규 없음 — 중단)`); break }
    }
  }
} catch (err) {
  console.log('오류:', String(err.message).slice(0, 80))
}

await ctx.close().catch(() => {})

if (sessionDead) {
  console.log('═'.repeat(56))
  console.log(' ⛔ 세션 만료. 재로그인: node scripts/session-login.mjs 1688')
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 3
} else {
  const offers = [...collected.values()]
  const saved = offers.length ? await saveToDb(offers) : 0
  console.log('═'.repeat(56))
  console.log(` ✅ 수집 ${offers.length}건 (${pagesSeen}응답) → DB 저장 ${saved}건`)
  console.log(`    검증: node scripts/verify-collection.mjs --since 30`)
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 0
}
setTimeout(() => process.exit(process.exitCode), 400)
