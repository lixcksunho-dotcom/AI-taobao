/**
 * 한국어 상세설명 생성 — 제목/가격 기반으로 쇼핑몰 상세설명 문구 생성(Haiku)
 * description_kr 컬럼에 저장 (없으면 안내).
 * 사용법: node scripts/generate-descriptions.mjs [--all]
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(dir, '..', '.env.local'), 'utf-8')
  .split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const all = process.argv.includes('--all')

// description_kr 컬럼이 없어 DDL 불가 → 비어있는 category 컬럼을 상세설명 저장에 재사용
const FIELD = 'category'
const { data: products } = await sb.from('products')
  .select(`id, title_kr, title_cn, price_krw, ${FIELD}`).like('taobao_id', '1688_%')
const todo = (products || []).filter(p => (p.title_kr || p.title_cn) && (all || !p[FIELD]))
console.log(`상세설명 생성 대상: ${todo.length}개`)

let done = 0
for (const p of todo) {
  const name = p.title_kr || p.title_cn
  const prompt =
    `너는 한국 여성의류 쇼핑몰 MD다. 아래 상품의 상세페이지 설명 문구를 써라.\n` +
    `상품명: ${name}\n판매가: ${p.price_krw ? p.price_krw.toLocaleString() + '원' : '미정'}\n\n` +
    `요구사항:\n- 친근하고 감성적인 톤, 구매욕 자극\n- 소재감/실루엣/코디 팁/추천 상황을 자연스럽게\n` +
    `- 3~4문장 + 핵심 포인트 3개(• 불릿)\n- 과장광고/허위 표현 금지\n출력은 설명 본문만(제목 반복 금지).`
  try {
    const res = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    const desc = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    if (desc) {
      await sb.from('products').update({ [FIELD]: desc, updated_at: new Date().toISOString() }).eq('id', p.id)
      done++
      if (done <= 1) console.log(`\n[샘플] ${name}\n${desc}\n`)
    }
  } catch (e) { console.log(`  오류(${p.id}): ${String(e.message).slice(0, 50)}`) }
  if (done % 10 === 0 && done) console.log(`  ${done}/${todo.length}`)
}
console.log(`\n✅ 상세설명 생성 완료: ${done}개`)
process.exit(0)
