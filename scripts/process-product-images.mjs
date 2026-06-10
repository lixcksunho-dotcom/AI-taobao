/**
 * 상품 이미지 종단 처리: 상세컷 스크래핑 → 중국어→한국어 번역렌더 → Storage 업로드 → DB 갱신
 *
 * 사용법: node scripts/process-product-images.mjs <offerId> [--skip-scrape]
 *   예: node scripts/process-product-images.mjs 1050416146257
 *
 * 결과: products.images = [대표이미지, ...번역된 상세컷 URL]
 *       Storage: product-images/<id>/detail/NN.jpg
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
function loadEnv() {
  return Object.fromEntries(
    readFileSync(resolve(root, '.env.local'), 'utf-8').split('\n')
      .map(l => l.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]))
}
const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'product-images'
const STORAGE_HOST = env.NEXT_PUBLIC_SUPABASE_URL.replace(/^https?:\/\//, '')

const OFFER = (process.argv[2] || '').replace(/^1688_/, '')
const skipScrape = process.argv.includes('--skip-scrape')
const raw = process.argv.includes('--raw')      // 번역 없이 원본 재호스팅(품질필터만)
const smart = process.argv.includes('--smart')  // 옵션차트만 번역, 나머지 원본
if (!OFFER) { console.error('offerId 필요'); process.exit(1) }

const detailDir = resolve(root, '_detailsample', OFFER)
const outDir = resolve(root, '_processed', OFFER)
mkdirSync(outDir, { recursive: true })

console.log('═'.repeat(56))
console.log(` 상품 이미지 처리: offer ${OFFER}`)
console.log('═'.repeat(56))

// 1) 상세컷 스크래핑 (없으면)
const hasDetail = existsSync(detailDir) && readdirSync(detailDir).some(f => /\.(jpg|png|webp)/i.test(f))
if (!hasDetail && !skipScrape) {
  console.log('[1] 상세컷 스크래핑...')
  execFileSync('node', [resolve(dir, 'scrape-detail.mjs'), OFFER], { stdio: 'inherit', cwd: root })
} else {
  console.log(`[1] 상세컷 ${hasDetail ? '이미 있음' : '스킵'}`)
}

// 2) 이미지 처리 (raw=품질필터만 / 기본=번역렌더)
console.log(raw ? '[2] 원본 재호스팅 (품질필터만)...' : '[2] 중국어→한국어 번역 렌더 (배치)...')
const pyArgs = [resolve(dir, 'translate_image.py'), detailDir, outDir, '--batch', '--cache', resolve(root, '_out', 'cache.json')]
if (raw) pyArgs.push('--raw')
if (smart) pyArgs.push('--smart')
execFileSync('python', pyArgs, { stdio: 'inherit', cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })

// 3) Storage 업로드 (기존 상세컷 폴더 비우고 새로 — 제외된 옛 junk 제거)
console.log('[3] Storage 업로드...')
const { data: existing } = await sb.storage.from(BUCKET).list(`${OFFER}/detail`)
if (existing?.length) {
  await sb.storage.from(BUCKET).remove(existing.map(e => `${OFFER}/detail/${e.name}`))
  console.log(`  기존 상세컷 ${existing.length}개 정리`)
}
const files = readdirSync(outDir).filter(f => /\.jpg$/i.test(f)).sort()
const urls = []
let up = 0
for (let i = 0; i < files.length; i++) {
  const buf = readFileSync(resolve(outDir, files[i]))
  const path = `${OFFER}/detail/${String(i).padStart(2, '0')}.jpg`
  const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true })
  if (error) { console.log('  업로드 오류:', error.message); continue }
  urls.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  up++
}
console.log(`  업로드 ${up}개`)

// 4) DB 갱신: images = [대표(기존 rehosted) , ...번역상세컷]
const { data: prod } = await sb.from('products').select('id, images').eq('taobao_id', `1688_${OFFER}`).single()
if (prod) {
  const cur = Array.isArray(prod.images) ? prod.images : []
  const main = cur.filter(u => typeof u === 'string' && u.includes(STORAGE_HOST) && !u.includes('/detail/'))
  const newImages = [...new Set([...main.slice(0, 1), ...urls])]
  const { error } = await sb.from('products').update({ images: newImages, updated_at: new Date().toISOString() }).eq('id', prod.id)
  console.log(error ? `  DB 오류: ${error.message}` : `  DB 갱신: images ${newImages.length}장`)
} else {
  console.log('  (DB에 해당 상품 없음 — Storage만 저장됨)')
}

console.log('═'.repeat(56))
console.log(` ✅ 완료: offer ${OFFER}  상세컷 ${up}장 처리`)
console.log('═'.repeat(56))
