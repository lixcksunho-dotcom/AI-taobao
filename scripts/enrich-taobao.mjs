/**
 * 타오바오 상품 보강(detail) — 상세컷 이미지 + 옵션(색상/사이즈)을 한 번에 수집
 *
 * 1688과 달리 타오바오 PC상세는 데이터가 흩어져 있어 세 출처를 조합:
 *   - 헤드 갤러리 : __ICE_APP_CONTEXT__ 의 headImageVO.images (대표 여러장)
 *   - 상세설명컷  : mtop.taobao.detail.getdesc 응답 data.components 의 alicdn 이미지
 *   - 옵션(SKU)   : __ICE_APP_CONTEXT__ 의 skuBase.props (name=颜色分类/尺码, values[].name)
 * 옵션 값 노이즈(마케팅어·体重권장 【】)는 1688과 동일 패턴이라 같은 정제로직 재사용.
 *
 * 결과: products.images = [헤드…, 상세컷…](dedupe), products.options = 번역된 그룹
 *
 * 사용법:
 *   node scripts/enrich-taobao.mjs <itemId>          (단일)
 *   node scripts/enrich-taobao.mjs --all [N]         (images 1장 이하인 taobao_ 상품 N개)
 *   node scripts/enrich-taobao.mjs --all [N] --force (전체 재보강)
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

chromium.use(StealthPlugin())
const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env.local'), 'utf-8')
  .split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ai = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null

const PROFILE = resolve(root, '.chrome-profile')
if (!existsSync(PROFILE)) { console.error('❌ .chrome-profile 없음. session-login.mjs taobao 먼저'); process.exit(3) }

const norm = (u) => u && u.startsWith('//') ? 'https:' + u : u
const unwrap = (b) => { const m = b.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/); return m ? m[1] : b }
const isContentImg = (u) => /alicdn|tphoto/i.test(u) && /\.(jpg|jpeg|png|webp)/i.test(u) &&
  !/\.gif/i.test(u) && !/_(\d{1,2}|[1-4]\dx[1-4]\d)x\d/i.test(u) // 초소형 아이콘 접미사 제외

// 옵션 값 정제 (1688 parseGroups 와 동일 규칙)
function cleanVal(t) {
  return String(t)
    .replace(/[\(（\[【][^)）\]】]*[\)）\]】]/g, '')   // 닫힌 괄호쌍(体重권장 등)
    .replace(/[\(（\[【].*$/, '')                       // 미닫힌 괄호 이후
    .replace(/^[A-Za-z]{0,3}\d{3,}#?\s*/, '')           // 모델코드 접두
    .replace(/\s+(高品质|高质量|高级|精品|加厚|新款|爆款)\b/g, '') // 마케팅 수식어
    .replace(/\s+\d+(\.\d+)?\s*(kg|公斤|斤).*$/i, '')   // 体重 꼬리
    .replace(/[-+_.,、·\s]+$/, '').replace(/\s+/g, ' ').trim()
}

async function translateOptions(groups) {
  if (!groups.length || !ai) return groups
  const flat = []
  groups.forEach(g => { flat.push(g.type); g.values.forEach(v => flat.push(v)) })
  const prompt = `다음 쇼핑몰 옵션(색상/사이즈) 용어를 한국 쇼핑몰 표기로 짧게 번역. 색상은 한 단어(예: 黑色→블랙, 杏色→아이보리, 卡其→카키). 사이즈/숫자는 그대로(均码→프리사이즈). 颜色分类→색상, 尺码→사이즈. JSON 객체로만 {"원문":"번역"}:\n${flat.join('\n')}`
  try {
    const res = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const map = JSON.parse(text.match(/\{[\s\S]*\}/)[0])
    return groups.map(g => ({ type: map[g.type] || g.type, values: g.values.map(v => map[v] || v) }))
  } catch { return groups }
}

async function enrichOne(ctx, id) {
  const page = await ctx.newPage()
  const descImgs = []
  page.on('response', async (res) => {
    if (!/detail\.getdesc/i.test(res.url())) return
    let b = ''; try { b = await res.text() } catch { return }
    try {
      const j = JSON.parse(unwrap(b))
      const s = JSON.stringify(j.data?.components ?? j.data ?? {})
      const re = /(https?:)?\/\/[^"\\]*?(alicdn|tphoto)[^"\\]*?\.(jpg|jpeg|png|webp)/gi
      for (const m of s.matchAll(re)) { const u = norm(m[0]); if (isContentImg(u) && !descImgs.includes(u)) descImgs.push(u) }
    } catch {}
  })
  try {
    await page.goto(`https://item.taobao.com/item.htm?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 3500))
    const t = (await page.title().catch(() => '')) || ''
    if (/登录|login|验证|拦截/i.test(t) || /login/i.test(page.url())) { console.log(`  ${id}: ⛔ 세션/캡차`); return { dead: true } }

    // 상세설명 탭(宝贝详情/商品详情)을 클릭해 getdesc 로딩 유도
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('*')].find(e =>
        e.children.length === 0 && /^(宝贝详情|商品详情|图文详情|详情)$/.test((e.textContent || '').trim()) && e.offsetParent !== null)
      tab?.scrollIntoView({ block: 'center' }); tab?.click()
    }).catch(() => {})
    // 깊은 스크롤 + getdesc 이미지가 채워질 때까지 대기(최대 ~18초)
    for (let i = 0; i < 18 && descImgs.length === 0; i++) {
      await page.mouse.wheel(0, 1600).catch(() => {})
      await new Promise(r => setTimeout(r, 1000))
    }
    await new Promise(r => setTimeout(r, 1500))

    // 헤드 갤러리 + skuBase 옵션을 글로벌에서 추출
    const got = await page.evaluate(() => {
      const seen = new Set(); let head = null, skuBase = null
      function walk(n, d) {
        if (d > 22 || n == null || typeof n !== 'object' || seen.has(n)) return
        seen.add(n)
        if (!Array.isArray(n)) {
          if (!head && Array.isArray(n.images) && n.images.some(x => typeof x === 'string' && /alicdn/.test(x))) head = n.images
          if (!skuBase && n.skuBase && n.skuBase.props) skuBase = n.skuBase
        }
        for (const k in n) walk(n[k], d + 1)
      }
      try { walk(window.__ICE_APP_CONTEXT__, 0) } catch {}
      const groups = (skuBase?.props || []).map(p => ({ type: p.name || '', values: (p.values || []).map(v => v.name || '') }))
      return { head: head || [], groups }
    })

    const headImgs = (got.head || []).map(norm).filter(isContentImg)
    const images = [...new Set([...headImgs, ...descImgs])].slice(0, 30)

    // 옵션 정제
    let groups = (got.groups || []).map(g => {
      const seen = new Set()
      const values = g.values.map(cleanVal).filter(v => v && v.length <= 40)
        .filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      return { type: g.type, values }
    }).filter(g => g.values.length)
    groups = await translateOptions(groups)
    // 번역 후 생기는 중복 값 제거(셀러의 유사 색상명이 같은 한국어로 수렴하는 경우)
    groups = groups.map(g => {
      const seen = new Set()
      return { type: g.type, values: g.values.filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }) }
    })

    const patch = { updated_at: new Date().toISOString() }
    if (images.length) patch.images = images
    if (groups.length) patch.options = groups
    await sb.from('products').update(patch).eq('taobao_id', `taobao_${id}`)
    console.log(`  ${id}: 이미지 ${images.length}장(헤드 ${headImgs.length}+상세 ${descImgs.length}) · 옵션 ${groups.map(g => g.type + '(' + g.values.length + ')').join(',') || '없음'}`)
    return { images: images.length, options: groups.length }
  } catch (e) {
    console.log(`  ${id}: 오류 ${String(e.message).slice(0, 50)}`)
    return { error: true }
  } finally { await page.close().catch(() => {}) }
}

const args = process.argv.slice(2)
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'], extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
})

if (args[0] === '--all') {
  const N = parseInt(args[1], 10) || 999
  const force = args.includes('--force')
  const { data } = await sb.from('products').select('taobao_id, images').like('taobao_id', 'taobao_%')
  let list = (data || [])
  if (!force) list = list.filter(p => !Array.isArray(p.images) || p.images.length <= 1)
  const ids = list.map(p => p.taobao_id.replace('taobao_', '')).slice(0, N)
  console.log(`타오바오 보강 대상: ${ids.length}개 (${force ? '전체 재보강' : 'images≤1만'})`)
  let ok = 0, dead = false
  for (const id of ids) { const r = await enrichOne(ctx, id); if (r.dead) { dead = true; break } if (r.images || r.options) ok++ }
  console.log(`\n${dead ? '⛔ 세션 만료로 중단' : '✅ 완료'}: ${ok}/${ids.length} 보강`)
} else if (args[0]) {
  await enrichOne(ctx, args[0].replace(/^taobao_/, ''))
} else {
  console.log('사용법: enrich-taobao.mjs <itemId> | --all [N] [--force]')
}
await ctx.close().catch(() => {})
setTimeout(() => process.exit(0), 300)
