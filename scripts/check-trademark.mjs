/**
 * 상표권/지재권 검수 — 상품 제목·옵션을 브랜드/금지어 목록과 대조해 차단 플래그
 * trademark_status: 'passed' | 'blocked', trademark_blocked_by: 매칭된 단어
 * 사용법: node scripts/check-trademark.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(dir, '..', '.env.local'), 'utf-8')
  .split('\n').map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 브랜드/금지어 (EN/KR/CN) — 상표권·지재권·짝퉁 표현
const BLOCK = [
  // 명품
  'gucci','구찌','古驰','louis vuitton','루이비통','路易威登','lv','chanel','샤넬','香奈儿',
  'prada','프라다','普拉达','hermes','hermès','에르메스','爱马仕','dior','디올','迪奥',
  'balenciaga','발렌시아가','巴黎世家','versace','베르사체','范思哲','burberry','버버리','博柏利',
  'givenchy','지방시','纪梵希','valentino','발렌티노','fendi','펜디','芬迪','celine','셀린느',
  'bottega','보테가','moncler','몽클레어','canada goose','캐나다구스','loewe','로에베','miu miu','미우미우',
  'ysl','saint laurent','생로랑','goyard','고야드','jacquemus','자크뮈스',
  // 스트리트/스포츠
  'supreme','슈프림','bape','베이프','a bathing ape','virgil abloh',
  'palace','스톤아일랜드','stone island','vetements','베트멍','nike','나이키','耐克',
  'adidas','아디다스','阿迪达斯','yeezy','이지부스트','이지 부스트','椰子','jordan','조던','乔丹','air jordan','에어조던',
  'new balance','뉴발란스','newbalance','the north face','노스페이스','노페이스',
  'lululemon','룰루레몬','salomon','살로몬','arcteryx','아크테릭스','ralph lauren','랄프로렌','랄프 로렌',
  'disney','디즈니','迪士尼','sanrio','산리오','hello kitty','헬로키티','pokemon','포켓몬',
  // 짝퉁/복제 표현
  'replica','레플리카','짝퉁','고퀄','aaa급','복제품','정품급','미러급','이미테이션',
  '仿品','高仿','精仿','完美复刻','原单','尾单',
]
// Latin(영문/숫자)은 단어경계, CJK/한글은 부분일치(모호 짧은단어는 위에서 제거함)
const isLatin = (s) => /^[a-z0-9 :'’\-]+$/i.test(s)
const matches = (hay, b) => {
  const nb = b.toLowerCase()
  if (isLatin(b)) {
    return new RegExp(`(^|[^a-z0-9])${nb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(hay)
  }
  return hay.includes(nb)
}
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ')

console.log('═'.repeat(56))
console.log(' 상표권/지재권 검수')
console.log('═'.repeat(56))

const { data: products } = await sb.from('products').select('id, title_kr, title_cn, options').like('taobao_id', '1688_%')
let blocked = 0, passed = 0
const hits = []
for (const p of products || []) {
  // 브랜드는 제목만 검사 (색상 옵션의 '오프화이트' 등 색상명 오탐 방지)
  const hay = norm([p.title_kr, p.title_cn].join(' '))
  const matched = BLOCK.filter(b => matches(hay, b))
  if (matched.length) {
    await sb.from('products').update({ trademark_status: 'blocked', trademark_blocked_by: matched.join(', '), updated_at: new Date().toISOString() }).eq('id', p.id)
    blocked++; hits.push(`  ⛔ [${matched.join(',')}]  ${(p.title_kr || p.title_cn || '').slice(0, 36)}`)
  } else {
    await sb.from('products').update({ trademark_status: 'passed', trademark_blocked_by: null, updated_at: new Date().toISOString() }).eq('id', p.id)
    passed++
  }
}
if (hits.length) { console.log('\n[차단된 상품]'); console.log(hits.join('\n')) }
console.log('\n' + '═'.repeat(56))
console.log(` ✅ 검수 완료: 통과 ${passed} · 차단 ${blocked}`)
console.log('═'.repeat(56))
process.exit(0)
