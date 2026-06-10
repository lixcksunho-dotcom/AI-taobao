/**
 * 이미지 재호스팅 — 1688/타오바오 CDN 원본을 Supabase Storage로 옮기고
 * DB products.images 를 자체(공개) URL 로 교체한다.
 *
 * - AI/과금 없음. 원본 차단·링크만료 대비 + 자체 도메인 서빙.
 * - 이미 재호스팅된 이미지(스토리지 도메인 포함)는 건너뜀.
 *
 * 사용법:
 *   node scripts/rehost-images.mjs               (전체)
 *   node scripts/rehost-images.mjs --limit 20    (20개만)
 *   node scripts/rehost-images.mjs --since 30    (최근 30분 수집분)
 * 종료코드: 0=성공, 2=설정오류
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const BUCKET = 'product-images'
const argv = process.argv.slice(2)
const limit = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1], 10) : null
const sinceMin = argv.includes('--since') ? parseInt(argv[argv.indexOf('--since') + 1], 10) : null

const STORAGE_HOST = env.NEXT_PUBLIC_SUPABASE_URL.replace(/^https?:\/\//, '')

function extOf(url, contentType) {
  if (/image\/webp/.test(contentType)) return 'webp'
  if (/image\/png/.test(contentType)) return 'png'
  const m = url.match(/\.(jpg|jpeg|png|webp)/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

async function ensureBucket() {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message)) throw new Error('버킷 생성 실패: ' + error.message)
  console.log(`✓ 버킷 '${BUCKET}' 준비됨`)
}

async function downloadAndUpload(srcUrl, taobaoId, idx) {
  const url = srcUrl.startsWith('//') ? 'https:' + srcUrl : srcUrl
  const res = await fetch(url, {
    headers: { Referer: 'https://www.1688.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') ?? 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  const path = `${taobaoId}/${idx}.${extOf(url, ct)}`
  const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true })
  if (error) throw new Error('업로드 실패: ' + error.message)
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

console.log('\n' + '═'.repeat(56))
console.log(' 이미지 재호스팅 → Supabase Storage')
console.log('═'.repeat(56))

try {
  await ensureBucket()
} catch (e) {
  console.error('❌', e.message)
  console.error('   (Storage 권한/버킷 정책 확인 필요)')
  process.exitCode = 2
  setTimeout(() => process.exit(2), 300)
}

let q = sb.from('products').select('id, taobao_id, images').not('images', 'eq', '[]')
if (sinceMin) q = q.gte('scraped_at', new Date(Date.now() - sinceMin * 60_000).toISOString())
if (limit) q = q.limit(limit)
const { data: products, error } = await q
if (error) { console.error('DB 조회 실패:', error.message); process.exit(2) }

console.log(`대상 상품: ${products.length}건\n`)
let doneImgs = 0, skipImgs = 0, failImgs = 0, updated = 0

for (const p of products) {
  const imgs = Array.isArray(p.images) ? p.images : []
  if (!imgs.length) continue
  const newUrls = []
  let changed = false
  for (let i = 0; i < imgs.length; i++) {
    const src = imgs[i]
    if (typeof src === 'string' && src.includes(STORAGE_HOST)) { newUrls.push(src); skipImgs++; continue }
    try {
      const hosted = await downloadAndUpload(src, p.taobao_id, i)
      newUrls.push(hosted); doneImgs++; changed = true
    } catch (e) {
      newUrls.push(src); failImgs++
      process.stdout.write(`  ✗ ${p.taobao_id}#${i}: ${e.message.slice(0, 40)}\n`)
    }
  }
  if (changed) {
    const { error: upErr } = await sb.from('products').update({ images: newUrls, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (!upErr) updated++
  }
}

console.log('\n' + '═'.repeat(56))
console.log(` ✅ 업로드 ${doneImgs} · 건너뜀 ${skipImgs} · 실패 ${failImgs} · 상품갱신 ${updated}건`)
console.log('═'.repeat(56) + '\n')
process.exitCode = 0
setTimeout(() => process.exit(0), 400)
