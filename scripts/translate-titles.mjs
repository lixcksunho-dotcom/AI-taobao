/**
 * 상품 제목 한국어 번역 — title_cn(중/영) → title_kr (Haiku, 배치)
 * 사용법: node scripts/translate-titles.mjs [--all]
 *   기본: title_kr 비어있는 것만. --all: 전부 재번역
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

const { data: products } = await sb.from('products').select('id, title_cn, title_kr').like('taobao_id', '1688_%')
const todo = (products || []).filter(p => p.title_cn && (all || !p.title_kr))
console.log(`제목 번역 대상: ${todo.length}개`)

const CHUNK = 20
let done = 0
for (let i = 0; i < todo.length; i += CHUNK) {
  const batch = todo.slice(i, i + CHUNK)
  const listing = batch.map((p, k) => `${k + 1}. ${p.title_cn}`).join('\n')
  const prompt =
    `다음은 중국 쇼핑몰 상품 제목들이다(영문/중문 혼재). 한국 쇼핑몰에 올릴 자연스럽고 매력적인 한국어 상품명으로 번역해라.\n` +
    `- 패션 용어로 간결하게, 검색 잘 되게 핵심 키워드 포함\n- 브랜드명 직역 금지\n- 번호 순서대로, 번역만\n` +
    `반드시 JSON 배열로만: ["번역1","번역2",...]\n\n${listing}`
  try {
    const res = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)[0])
    for (let k = 0; k < batch.length; k++) {
      const kr = arr[k]
      if (kr) {
        await sb.from('products').update({ title_kr: kr, updated_at: new Date().toISOString() }).eq('id', batch[k].id)
        done++
      }
    }
    console.log(`  ${Math.min(i + CHUNK, todo.length)}/${todo.length} 완료`)
  } catch (e) {
    console.log(`  배치 ${i} 오류: ${String(e.message).slice(0, 60)}`)
  }
}
console.log(`\n✅ 제목 번역 완료: ${done}개`)
process.exit(0)
