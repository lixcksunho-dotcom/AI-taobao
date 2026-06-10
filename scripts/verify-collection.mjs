/**
 * 스크래퍼 수집 결과 검증 하니스
 *
 * 대화형 수집(scrape-interactive.mjs) 이후 DB에 들어온 상품이
 * "진짜로 제대로 수집됐는지"를 자동 판정한다.
 *
 * 사용법:
 *   node scripts/verify-collection.mjs              (전체 검증)
 *   node scripts/verify-collection.mjs --since 30   (최근 30분 수집분만)
 *   node scripts/verify-collection.mjs --no-image   (이미지 접근 체크 생략)
 *
 * 종료코드: 0=PASS, 1=WARN, 2=FAIL  (CI/스크립트 연동용)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

// ── .env.local 로드 ──────────────────────────────────────────
function loadEnv() {
  const p = resolve(dir, '..', '.env.local')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf-8').split('\n')
      .map(l => l.match(/^([^#=]+)=(.*)$/))
      .filter(Boolean)
      .map(m => [m[1].trim(), m[2].trim()])
  )
}
const env = loadEnv()

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env.local에 Supabase URL / SERVICE_ROLE_KEY가 없습니다.')
  process.exit(2)
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const RATE   = parseFloat(env.CNY_TO_KRW_RATE ?? '190')
const MARGIN = parseFloat(env.MARGIN_RATE ?? '1.3')
const expectedKrw = (cny) => Math.ceil(cny * RATE * MARGIN / 100) * 100

// ── 인자 파싱 ────────────────────────────────────────────────
const argv = process.argv.slice(2)
const sinceMin  = argv.includes('--since') ? parseInt(argv[argv.indexOf('--since') + 1], 10) : null
const checkImg  = !argv.includes('--no-image')

// ── 유틸 ─────────────────────────────────────────────────────
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
const pct = (n, total) => total === 0 ? '0%' : `${Math.round(n / total * 100)}%`
const bar = (label, n, total) => {
  const p = total === 0 ? 0 : n / total
  const filled = Math.round(p * 20)
  return `  ${label.padEnd(14)} ${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${String(n).padStart(5)} / ${total}  (${pct(n, total)})`
}

let verdict = 0  // 0 PASS, 1 WARN, 2 FAIL
const warn = (msg) => { verdict = Math.max(verdict, 1); console.log(`  ${C.y}⚠ ${msg}${C.x}`) }
const fail = (msg) => { verdict = Math.max(verdict, 2); console.log(`  ${C.r}✗ ${msg}${C.x}`) }
const ok   = (msg) => console.log(`  ${C.g}✓ ${msg}${C.x}`)

// Windows + undici(keep-alive) 환경에서 process.exit() 즉시 호출 시
// libuv UV_HANDLE_CLOSING 어서션이 터지는 버그 회피: 종료를 살짝 지연.
function finish(code) {
  process.exitCode = code
  setTimeout(() => process.exit(code), 200)
}

function sourceOf(url = '') {
  if (url.includes('1688.com')) return '1688'
  if (url.includes('taobao.com')) return 'taobao'
  if (url.includes('aliexpress')) return 'aliexpress'
  return 'unknown'
}

// ── 메인 ─────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60))
console.log(` ${C.b}스크래퍼 수집 검증${C.x}   (환율 ${RATE} · 마진 ${MARGIN})`)
if (sinceMin) console.log(` ${C.d}최근 ${sinceMin}분 수집분만 대상${C.x}`)
console.log('═'.repeat(60))

let query = sb.from('products').select('*')
if (sinceMin) {
  const cutoff = new Date(Date.now() - sinceMin * 60_000).toISOString()
  query = query.gte('scraped_at', cutoff)
}
const { data: products, error } = await query
if (error) { console.error(`${C.r}DB 조회 실패: ${error.message}${C.x}`); finish(2); }
else await run(products)

async function run(products) {
const N = products.length
console.log(`\n[1] 총 상품 수: ${C.b}${N}${C.x}건`)
if (N === 0) {
  fail('수집된 상품이 0건입니다. 스크래퍼가 아직 한 건도 저장하지 못했습니다.')
  console.log('\n→ scrape-interactive.mjs 로 먼저 수집을 실행하세요.\n')
  return finish(2)
}

// 최근 수집 시각
const times = products.map(p => p.scraped_at).filter(Boolean).sort()
if (times.length) {
  console.log(`    가장 오래된 수집: ${C.d}${times[0]}${C.x}`)
  console.log(`    가장 최근 수집:   ${C.d}${times[times.length - 1]}${C.x}`)
}

// ── [2] 출처별 분포 ──────────────────────────────────────────
console.log(`\n[2] 출처별 분포`)
const bySource = {}
for (const p of products) bySource[sourceOf(p.taobao_url)] = (bySource[sourceOf(p.taobao_url)] ?? 0) + 1
for (const [s, n] of Object.entries(bySource)) console.log(bar(s, n, N))
if (bySource.unknown) warn(`출처 판별 불가 ${bySource.unknown}건 (taobao_url 형식 확인 필요)`)

// ── [3] 필드 완전성 ──────────────────────────────────────────
console.log(`\n[3] 필드 완전성 (값이 채워진 비율)`)
const filled = {
  title_cn:   products.filter(p => p.title_cn?.trim()).length,
  title_kr:   products.filter(p => p.title_kr?.trim()).length,
  price_cny:  products.filter(p => p.price_cny > 0).length,
  price_krw:  products.filter(p => p.price_krw > 0).length,
  images:     products.filter(p => Array.isArray(p.images) && p.images.length > 0).length,
  options:    products.filter(p => Array.isArray(p.options) && p.options.length > 0).length,
  keywords_cn: products.filter(p => Array.isArray(p.keywords_cn) && p.keywords_cn.length > 0).length,
}
console.log(bar('title_cn',   filled.title_cn,   N))
console.log(bar('title_kr',   filled.title_kr,   N))
console.log(bar('price_cny',  filled.price_cny,  N))
console.log(bar('price_krw',  filled.price_krw,  N))
console.log(bar('images',     filled.images,     N))
console.log(bar('options',    filled.options,    N))
console.log(bar('keywords_cn',filled.keywords_cn,N))

// 필수 필드 판정
if (filled.title_cn < N)  fail(`title_cn 누락 ${N - filled.title_cn}건 — 핵심 필드 비어있음`)
else ok('title_cn 전건 채워짐')
if (filled.price_cny < N) warn(`price_cny 0/누락 ${N - filled.price_cny}건 — 가격 파싱 실패 가능`)
if (filled.price_krw < N) warn(`price_krw 0/누락 ${N - filled.price_krw}건`)
if (filled.images === 0)  warn('이미지가 한 건도 없음 — 썸네일 파싱 실패 가능')
if (filled.title_kr === 0) console.log(`  ${C.d}ℹ title_kr 0건 — 번역 미실행(ANTHROPIC_API_KEY 미설정)이면 정상${C.x}`)

// ── [4] 가격 sanity ──────────────────────────────────────────
console.log(`\n[4] 가격 sanity 체크`)
let krwMismatch = 0, zeroPrice = 0, outlier = 0
for (const p of products) {
  if (!(p.price_cny > 0)) { zeroPrice++; continue }
  const exp = expectedKrw(p.price_cny)
  if (p.price_krw && Math.abs(p.price_krw - exp) > 100) krwMismatch++
  if (p.price_cny > 100000 || p.price_cny < 0.1) outlier++
}
console.log(`    KRW 환산식 불일치: ${krwMismatch}건  ${C.d}(price_krw ≠ ceil(cny×${RATE}×${MARGIN}/100)×100)${C.x}`)
console.log(`    가격 0/누락:       ${zeroPrice}건`)
console.log(`    이상치(범위 밖):   ${outlier}건`)
if (krwMismatch > N * 0.1) warn(`KRW 환산 불일치 ${krwMismatch}건 — 환율/마진 설정과 저장값이 다름`)
else if (krwMismatch === 0 && zeroPrice === 0) ok('전건 가격 환산 정상')
if (outlier > 0) warn(`가격 이상치 ${outlier}건 — 파싱 오류 의심`)

// ── [5] 중복 taobao_id ───────────────────────────────────────
console.log(`\n[5] 중복 taobao_id 체크`)
const idCount = {}
for (const p of products) idCount[p.taobao_id] = (idCount[p.taobao_id] ?? 0) + 1
const dups = Object.entries(idCount).filter(([, c]) => c > 1)
if (dups.length === 0) ok('중복 없음 (upsert onConflict 정상 동작)')
else fail(`중복 taobao_id ${dups.length}종 — ${dups.slice(0, 3).map(([id, c]) => `${id}×${c}`).join(', ')}`)

// ── [6] trademark_status 분포 ────────────────────────────────
console.log(`\n[6] 지재권 처리 상태`)
const byStatus = {}
for (const p of products) byStatus[p.trademark_status ?? 'null'] = (byStatus[p.trademark_status ?? 'null'] ?? 0) + 1
for (const [s, n] of Object.entries(byStatus)) console.log(bar(s, n, N))
const pending = byStatus.pending ?? 0
if (pending > 0) console.log(`  ${C.d}ℹ pending ${pending}건 — 파이프라인(번역·지재권) 미처리 상태. 정상.${C.x}`)

// ── [7] 재고 상태 분포 ───────────────────────────────────────
console.log(`\n[7] 재고 상태`)
const byStock = {}
for (const p of products) byStock[p.stock_status ?? 'null'] = (byStock[p.stock_status ?? 'null'] ?? 0) + 1
for (const [s, n] of Object.entries(byStock)) console.log(bar(s, n, N))

// ── [8] 이미지 URL 접근 가능 여부 (샘플) ─────────────────────
if (checkImg) {
  console.log(`\n[8] 이미지 URL 실제 접근 체크 (샘플 최대 10건)`)
  const withImg = products.filter(p => Array.isArray(p.images) && p.images[0]).slice(0, 10)
  if (withImg.length === 0) {
    warn('이미지가 있는 상품이 없어 접근 체크 생략')
  } else {
    let reach = 0, dead = 0
    for (const p of withImg) {
      const url = p.images[0].startsWith('//') ? 'https:' + p.images[0] : p.images[0]
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
        if (r.ok) reach++; else { dead++; }
      } catch { dead++ }
    }
    console.log(`    접근 성공: ${reach} / ${withImg.length}   실패: ${dead}`)
    if (reach === 0) fail('샘플 이미지 전부 접근 불가 — URL 파싱 형식 오류 의심')
    else if (dead > reach) warn(`이미지 접근 실패가 더 많음 (${dead} > ${reach})`)
    else ok('이미지 URL 접근 정상')
  }
} else {
  console.log(`\n[8] 이미지 접근 체크 ${C.d}(--no-image 로 생략됨)${C.x}`)
}

// ── 샘플 미리보기 ────────────────────────────────────────────
console.log(`\n[9] 수집 샘플 (최근 3건)`)
const recent = [...products].sort((a, b) => (b.scraped_at ?? '').localeCompare(a.scraped_at ?? '')).slice(0, 3)
for (const p of recent) {
  console.log(`  ${C.d}─${C.x}`)
  console.log(`    id    : ${p.taobao_id}  [${sourceOf(p.taobao_url)}]`)
  console.log(`    제목  : ${(p.title_cn ?? '').slice(0, 40)}`)
  console.log(`    가격  : ¥${p.price_cny} → ₩${p.price_krw}`)
  console.log(`    이미지: ${Array.isArray(p.images) ? p.images.length : 0}장`)
}

// ── 종합 판정 ────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60))
const label = verdict === 0 ? `${C.g}PASS — 수집 정상${C.x}`
            : verdict === 1 ? `${C.y}WARN — 일부 항목 점검 필요${C.x}`
            : `${C.r}FAIL — 수집에 문제 있음${C.x}`
console.log(` 종합 판정: ${C.b}${label}`)
console.log('═'.repeat(60) + '\n')
return finish(verdict)
}
