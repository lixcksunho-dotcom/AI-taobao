/**
 * 타오바오 무인 수집 (2024 SPA 대응) — 구조 자동탐지 파서 기반
 *
 * 1688과 동일 전략: 정적 검색 URL은 막혔으므로 타오바오 홈 검색창을
 * UI 흐름으로 구동 → mtop(h5api.m.taobao.com) 응답을 가로채 상품배열을
 * 자동탐지(parseSearchItems)로 파싱 → products 테이블에 저장.
 *
 * 전제: node scripts/session-login.mjs taobao  로 1회 로그인돼 있을 것.
 *
 * 사용법:
 *   node scripts/scrape-taobao.mjs "원피스" [페이지수=1] [headed|headless] [--dump]
 *     --dump : 상품을 뽑아낸 원본 mtop 응답을 debug-taobao-search.json 으로 저장
 *              (첫 실측 시 실제 셰이프 확보 → 파서 보정용)
 * 종료코드: 0=성공, 2=설정오류, 3=세션만료
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseSearchItems } from './lib-taobao.mjs'

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

const argv = process.argv.slice(2)
const DUMP = argv.includes('--dump')
const pos = argv.filter(a => !a.startsWith('--'))
const KEYWORD = pos[0] || '连衣裙'
const PAGES = Math.max(1, parseInt(pos[1], 10) || 1)
const HEADLESS = (pos[2] || 'headed') === 'headless'

const PROFILE = resolve(dir, '..', '.chrome-profile')
if (!existsSync(PROFILE)) {
  console.error('❌ .chrome-profile 없음. 먼저: node scripts/session-login.mjs taobao'); process.exit(3)
}
mkdirSync(PROFILE, { recursive: true })

const RATE = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const MARGIN = parseFloat(env.MARGIN_RATE ?? '1.3')
const calcKrw = (cny) => Math.ceil(cny * RATE * MARGIN / 100) * 100
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function saveToDb(items) {
  const now = new Date().toISOString()
  // 가격 0/이미지 없음 = 검색결과가 아닌 홈 프로모션·추천 위젯 잡음 → 저장 제외
  const clean = items.filter(o => o.cny > 0 && o.img)
  const dropped = items.length - clean.length
  if (dropped) console.log(`  (잡음 ${dropped}건 제외: 가격0/이미지없음)`)
  const rows = clean.map(o => ({
    taobao_id: `taobao_${o.id}`,
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
console.log(` 타오바오 수집 (새 SPA)  |  ${KEYWORD}  |  ${PAGES}p  |  ${HEADLESS ? 'headless' : 'headed'}${DUMP ? '  |  DUMP' : ''}`)
console.log('═'.repeat(56))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: HEADLESS, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
  ...(env.PROXY_SERVER ? { proxy: { server: env.PROXY_SERVER, username: env.PROXY_USER, password: env.PROXY_PASS } } : {}),
})

const collected = new Map()
let pagesSeen = 0
const dumps = []

// mtop JSONP 언랩 ( mtopjsonp1({...}) → {...} )
function unwrap(body) {
  const m = body.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/)
  return m ? m[1] : body
}

ctx.on('response', async (res) => {
  const u = res.url()
  // 타오바오 검색 데이터는 h5api/mtop 또는 s.taobao 비동기 응답으로 온다.
  // 엔드포인트명이 버전마다 달라 하드코딩 대신: JSON 같으면 일단 파싱 시도.
  if (!/h5api\.m\.taobao|mtop|s\.taobao\.com|acs\./i.test(u)) return
  const ct = (res.headers()['content-type'] || '')
  if (!/json|javascript|text/i.test(ct)) return
  let body = ''
  try { body = await res.text() } catch { return }
  if (!body || body.length < 50) return
  let json; try { json = JSON.parse(unwrap(body)) } catch { return }
  const items = parseSearchItems(json)
  if (items.length) {
    pagesSeen++
    let added = 0
    for (const o of items) if (!collected.has(o.id)) { collected.set(o.id, o); added++ }
    console.log(`  [응답] 상품 ${items.length}건 (신규 ${added}, 누적 ${collected.size})  ${u.slice(0, 60)}`)
    if (DUMP && dumps.length < 3) dumps.push({ url: u, json })
  }
})

const page = await ctx.newPage()
let sessionDead = false

try {
  // 세션이 살아있으면 s.taobao.com/search 직접 진입이 가장 안정적
  // (홈 검색창 Enter는 결과페이지로 안 넘어가 홈 위젯만 긁히는 문제가 있음)
  for (let p = 1; p <= PAGES; p++) {
    const before = collected.size
    const url = `https://s.taobao.com/search?q=${encodeURIComponent(KEYWORD)}&page=${p}&tab=all`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 2500))

    const title = await page.title().catch(() => '')
    if (/login|登录/i.test(page.url()) || /验证|拦截|安全/.test(title)) { sessionDead = true; break }

    // 결과 레이지로드 유도 (recommend 응답이 채워질 때까지 스크롤)
    for (let i = 0; i < 10 && collected.size === before; i++) {
      await page.mouse.wheel(0, 1500).catch(() => {})
      await new Promise(r => setTimeout(r, 1200))
    }
    if (collected.size === before) { console.log(`  (${p}p: 신규 없음 — 중단)`); break }
  }
} catch (err) {
  console.log('오류:', String(err.message).slice(0, 80))
}

await ctx.close().catch(() => {})

if (DUMP && dumps.length) {
  const out = resolve(dir, '..', 'debug-taobao-search.json')
  writeFileSync(out, JSON.stringify(dumps, null, 2), 'utf-8')
  console.log(`  🔎 원본 응답 ${dumps.length}건 덤프 → ${out}`)
}

if (sessionDead) {
  console.log('═'.repeat(56))
  console.log(' ⛔ 세션 만료/캡차. 재로그인: node scripts/session-login.mjs taobao')
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 3
} else {
  const items = [...collected.values()]
  const saved = items.length ? await saveToDb(items) : 0
  console.log('═'.repeat(56))
  console.log(` ✅ 수집 ${items.length}건 (${pagesSeen}응답) → DB 저장 ${saved}건`)
  if (!items.length) console.log('    ⚠ 0건: --dump 로 응답을 캡처해 파서 보정이 필요할 수 있음')
  else console.log(`    검증: node scripts/verify-collection.mjs --since 30`)
  console.log('═'.repeat(56) + '\n')
  process.exitCode = 0
}
setTimeout(() => process.exit(process.exitCode), 400)
