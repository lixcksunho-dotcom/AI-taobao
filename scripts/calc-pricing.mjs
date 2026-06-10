/**
 * 적정 판매가 계산 — 원가(CNY) + 배송비 + 쿠팡 수수료 + 목표마진 반영
 *
 * 판매가 = (원가KRW + 배송비) / (1 - 쿠팡수수료율 - 목표마진율)   (100원 올림)
 *   → 쿠팡 수수료와 마진을 떼고도 원가+배송비를 회수하도록 역산
 *
 * .env.local 설정(없으면 기본):
 *   CNY_TO_KRW_RATE=190  SHIPPING_FEE_KRW=5000  COUPANG_FEE_RATE=0.105  TARGET_MARGIN_RATE=0.30
 * 사용법: node scripts/calc-pricing.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(dir, '..', '.env.local'), 'utf-8')
  .split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const RATE     = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const SHIP     = parseFloat(env.SHIPPING_FEE_KRW ?? '5000')
const COUPANG  = parseFloat(env.COUPANG_FEE_RATE ?? '0.105')   // 패션 카테고리 ~10.5%
const MARGIN   = parseFloat(env.TARGET_MARGIN_RATE ?? '0.30')  // 목표 마진 30%
const DIVISOR  = 1 - COUPANG - MARGIN

console.log('═'.repeat(56))
console.log(` 적정 판매가 계산  (환율 ${RATE} · 배송비 ${SHIP.toLocaleString()}원 · 쿠팡 ${(COUPANG*100).toFixed(1)}% · 마진 ${(MARGIN*100).toFixed(0)}%)`)
console.log('═'.repeat(56))
if (DIVISOR <= 0) { console.error('❌ 쿠팡수수료+마진이 100% 이상입니다. 설정 확인.'); process.exit(2) }

const sellPrice = (cny) => {
  const costKrw = cny * RATE
  const raw = (costKrw + SHIP) / DIVISOR
  return Math.ceil(raw / 100) * 100   // 100원 단위 올림
}

const { data: products } = await sb.from('products').select('id, price_cny, price_krw, title_kr, title_cn').like('taobao_id', '1688_%')
let updated = 0
const samples = []
for (const p of products || []) {
  if (!(p.price_cny > 0)) continue
  const price = sellPrice(p.price_cny)
  if (price !== p.price_krw) {
    await sb.from('products').update({ price_krw: price, updated_at: new Date().toISOString() }).eq('id', p.id)
    updated++
  }
  if (samples.length < 5) {
    const costKrw = Math.round(p.price_cny * RATE)
    const profit = Math.round(price * (1 - COUPANG) - costKrw - SHIP)
    samples.push(`  ¥${p.price_cny} → 원가 ${costKrw.toLocaleString()}원 +배송 → 판매가 ${price.toLocaleString()}원 (수수료후 순익 ~${profit.toLocaleString()}원)  ${(p.title_kr||'').slice(0,18)}`)
  }
}
console.log(samples.join('\n'))
console.log('═'.repeat(56))
console.log(` ✅ ${updated}개 상품 판매가 갱신`)
console.log('═'.repeat(56))
process.exit(0)
