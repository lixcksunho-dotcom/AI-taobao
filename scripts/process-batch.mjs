/**
 * 여러 상품 일괄: 각 상품마다 상세컷 스크래핑 → 번역렌더 → 업로드 → DB 갱신
 * 사용법: node scripts/process-batch.mjs [개수=5]
 *   아직 상세컷 처리 안 된(images에 /detail/ 없는) 상품부터 처리
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env.local'), 'utf-8').split('\n')
  .map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const args = process.argv.slice(2)
const force = args.includes('--force')   // 이미 처리된 것도 재처리(로컬 상세컷 재사용)
const raw = args.includes('--raw')       // 번역 없이 원본 재호스팅(품질필터만)
const smart = args.includes('--smart')   // 옵션차트만 번역, 나머지 원본
const N = parseInt(args.find(a => /^\d+$/.test(a)) || '5', 10)

const { data: products } = await sb.from('products')
  .select('taobao_id, images, title_cn')
  .like('taobao_id', '1688_%')
  .order('scraped_at', { ascending: false })
  .limit(200)

// 기본: 아직 상세컷 없는 것만. --force: 전부 재처리
const todo = (products || []).filter(p => {
  if (force) return true
  const imgs = Array.isArray(p.images) ? p.images : []
  return !imgs.some(u => typeof u === 'string' && u.includes('/detail/'))
}).slice(0, N)

console.log(`처리 대상 ${todo.length}개 (요청 ${N})\n`)

let ok = 0, fail = 0
for (const p of todo) {
  const offer = p.taobao_id.replace('1688_', '')
  console.log(`\n■■■ ${offer}  ${(p.title_cn || '').slice(0, 30)} ■■■`)
  try {
    const childArgs = [resolve(dir, 'process-product-images.mjs'), offer]
    if (raw) childArgs.push('--raw')
    if (smart) childArgs.push('--smart')
    execFileSync('node', childArgs,
      { stdio: 'inherit', cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 240000 })
    ok++
  } catch (e) {
    console.log(`  실패: ${String(e.message).slice(0, 60)}`)
    fail++
  }
}
console.log(`\n═══ 배치 완료: 성공 ${ok} / 실패 ${fail} ═══`)
process.exit(0)
