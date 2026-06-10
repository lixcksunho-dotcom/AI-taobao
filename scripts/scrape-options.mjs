/**
 * 상품 옵션(색상/사이즈) 스크래핑 + 한국어 번역 → products.options
 * 사용법: node scripts/scrape-options.mjs <offerId>   (단일 테스트)
 *         node scripts/scrape-options.mjs --all [N]    (전체/N개)
 */
import { chromium } from 'playwright-extra'
import Stealth from 'puppeteer-extra-plugin-stealth'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

chromium.use(Stealth())
const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env.local'), 'utf-8')
  .split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const PROFILE = resolve(root, '.chrome-profile')
const PROP_LABELS = /^(color|colour|颜色|颜色分类|size|尺码|尺寸)$/i

async function extractOptions(page) {
  return page.evaluate(() => {
    // (1) 신형 레이아웃: .module-od-sku-selection innerText 줄단위 파싱
    const root = document.querySelector('.module-od-sku-selection')
    if (root) {
      const lines = (root.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)
      const seq = []
      const seen = new Set()
      for (let t of lines) {
        if (/^[¥￥]/.test(t)) continue           // 가격줄 제외
        if (/库存|剩余|stock left/i.test(t)) continue
        t = t.replace(/\s*[¥￥]\s*[\d.]+.*$/, '').trim()  // 끝에 붙은 가격 제거
        if (!t) continue
        const key = t.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key); seq.push(t)
      }
      if (seq.length) return seq
    }
    // (2) 폴백(구형): SKU 패널의 짧은 텍스트를 순서대로 수집
    const nodes = [...document.querySelectorAll('[class*="sku"] *, [class*="prop"] *, [class*="spec"] *')]
    const seen = new Set(); const seq = []
    for (const el of nodes) {
      if (el.children.length) continue
      const t = (el.textContent || '').trim()
      if (!t || t.length > 14) continue
      if (/[¥￥]|库存|stock|stk|\d{3,}/.test(t)) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key); seq.push(t)
    }
    return seq
  })
}

function parseGroups(seq) {
  const groups = []; let cur = null
  for (let t of seq) {
    if (PROP_LABELS.test(t)) { cur = { type: t, values: [] }; groups.push(cur) }
    else if (cur) {
      // 괄호/대괄호 안내문구 제거 (체중 권장·재고 등), 미닫힌 괄호 꼬리까지 제거
      t = t.replace(/[\(（\[【][^)）\]】]*[\)）\]】]/g, '')  // 닫힌 괄호쌍
           .replace(/[\(（\[【].*$/, '')                      // 미닫힌 괄호 이후
           .replace(/^[A-Za-z]{0,3}\d{3,}#?\s*/, '')          // 모델코드 접두사(3912#, YF4047)
           .replace(/\s+\d+(\.\d+)?\s*(kg|公斤|斤).*$/i, '')  // 체중 권장 꼬리(괄호없음)
           .replace(/\s+(suggested|recommended|推荐|建议|适合).*$/i, '')
           .replace(/[-+_.,、·\s]+$/, '')                     // 꼬리 구두점
           .replace(/\s+/g, ' ').trim()
      if (t && t.length <= 40) cur.values.push(t)
    }
  }
  // 그룹 내 중복 값 제거(정제 후 생기는 중복)
  for (const g of groups) {
    const seen = new Set()
    g.values = g.values.filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  }
  return groups.filter(g => g.values.length)
}

async function translateOptions(groups) {
  if (!groups.length) return groups
  const flat = []
  groups.forEach(g => { flat.push(g.type); g.values.forEach(v => flat.push(v)) })
  const prompt = `다음 쇼핑몰 옵션(색상/사이즈) 용어를 한국 쇼핑몰 표기로 짧게 번역. 색상은 한 단어(예: Khaki→카키, Apricot→아이보리, black→블랙). 사이즈/숫자는 그대로(One Size→프리사이즈). JSON 객체로만 {"원문":"번역"}:\n${flat.join('\n')}`
  try {
    const res = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const map = JSON.parse(text.match(/\{[\s\S]*\}/)[0])
    return groups.map(g => ({ type: map[g.type] || g.type, values: g.values.map(v => map[v] || v) }))
  } catch { return groups }
}

async function processOffer(ctx, offer) {
  const page = await ctx.newPage()
  try {
    await page.goto(`https://detail.1688.com/offer/${offer}.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 4000))
    const seq = await extractOptions(page)
    const groups = parseGroups(seq)
    const translated = await translateOptions(groups)
    await sb.from('products').update({ options: translated, updated_at: new Date().toISOString() }).eq('taobao_id', `1688_${offer}`)
    console.log(`  ${offer}: ${translated.map(g => g.type + '(' + g.values.length + ')').join(', ') || '옵션없음'}`)
    return translated.length
  } catch (e) {
    console.log(`  ${offer}: 오류 ${String(e.message).slice(0, 40)}`)
    return 0
  } finally { await page.close() }
}

const arg = process.argv[2]
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN',
})

if (arg === '--all') {
  const N = parseInt(process.argv[3] || '999', 10)
  const { data } = await sb.from('products').select('taobao_id').like('taobao_id', '1688_%')
  const offers = (data || []).map(p => p.taobao_id.replace('1688_', '')).slice(0, N)
  console.log(`옵션 스크래핑: ${offers.length}개`)
  let ok = 0
  for (const o of offers) { if (await processOffer(ctx, o)) ok++ }
  console.log(`\n✅ ${ok}개 옵션 수집`)
} else {
  await processOffer(ctx, (arg || '').replace(/^1688_/, ''))
}
await ctx.close()
setTimeout(() => process.exit(0), 300)
