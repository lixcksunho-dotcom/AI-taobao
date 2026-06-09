/**
 * Supabase SQL 실행 스크립트
 * node scripts/run-sql.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const dir = dirname(fileURLToPath(import.meta.url))

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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

// ── STEP 1: trademark_blocks 테이블 생성 시도 ──────────────
console.log('\n[1/4] trademark_blocks 테이블 확인...')
const { error: tableCheck } = await supabase
  .from('trademark_blocks')
  .select('id')
  .limit(1)

if (tableCheck) {
  console.log('테이블 없음 → 수동 생성 필요')
  console.log('\n아래 SQL을 Supabase SQL Editor에서 실행하세요:')
  console.log('https://supabase.com/dashboard/project/mjvupcxqxefgbjarntka/editor\n')
  console.log('━'.repeat(60))
  console.log(`CREATE TABLE IF NOT EXISTS trademark_blocks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword     TEXT NOT NULL UNIQUE,
  lang        TEXT NOT NULL DEFAULT 'all',
  category    TEXT NOT NULL DEFAULT 'brand',
  note        TEXT,
  block_count INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS trademark_status    TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS trademark_blocked_by TEXT,
  ADD COLUMN IF NOT EXISTS keywords_cn         TEXT[],
  ADD COLUMN IF NOT EXISTS keywords_kr         TEXT[],
  ADD COLUMN IF NOT EXISTS options_kr          JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS processed_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_trademark_status ON products(trademark_status);
CREATE INDEX IF NOT EXISTS idx_trademark_blocks_keyword  ON trademark_blocks(lower(keyword));

CREATE OR REPLACE FUNCTION increment_block_count(kw TEXT)
RETURNS void AS $$
BEGIN
  UPDATE trademark_blocks
  SET block_count = block_count + 1
  WHERE lower(keyword) = lower(kw);
END;
$$ LANGUAGE plpgsql;`)
  console.log('━'.repeat(60))
  console.log('\n위 SQL 실행 후 다시 이 스크립트를 실행하면 브랜드 데이터가 자동 삽입됩니다.')
  process.exit(0)
} else {
  console.log('✓ trademark_blocks 테이블 존재')
}

// ── STEP 2: products 테이블 컬럼 확인 ──────────────────────
console.log('\n[2/4] products 컬럼 확인...')
const { data: sampleProduct } = await supabase
  .from('products')
  .select('trademark_status')
  .limit(1)

if (sampleProduct !== null) {
  console.log('✓ trademark_status 컬럼 존재')
} else {
  console.log('⚠ products 테이블 컬럼 확인 필요')
}

// ── STEP 3: 브랜드 데이터 삽입 ─────────────────────────────
console.log('\n[3/4] 브랜드 차단 키워드 삽입...')

const brands = [
  // EN
  { keyword: 'gucci',          lang: 'en', category: 'brand',   note: '구찌' },
  { keyword: 'louis vuitton',  lang: 'en', category: 'brand',   note: '루이비통' },
  { keyword: 'lv',             lang: 'en', category: 'brand',   note: '루이비통 약자' },
  { keyword: 'chanel',         lang: 'en', category: 'brand',   note: '샤넬' },
  { keyword: 'prada',          lang: 'en', category: 'brand',   note: '프라다' },
  { keyword: 'hermes',         lang: 'en', category: 'brand',   note: '에르메스' },
  { keyword: 'dior',           lang: 'en', category: 'brand',   note: '디올' },
  { keyword: 'balenciaga',     lang: 'en', category: 'brand',   note: '발렌시아가' },
  { keyword: 'versace',        lang: 'en', category: 'brand',   note: '베르사체' },
  { keyword: 'burberry',       lang: 'en', category: 'brand',   note: '버버리' },
  { keyword: 'givenchy',       lang: 'en', category: 'brand',   note: '지방시' },
  { keyword: 'valentino',      lang: 'en', category: 'brand',   note: '발렌티노' },
  { keyword: 'fendi',          lang: 'en', category: 'brand',   note: '펜디' },
  { keyword: 'celine',         lang: 'en', category: 'brand',   note: '셀린느' },
  { keyword: 'bottega veneta', lang: 'en', category: 'brand',   note: '보테가베네타' },
  { keyword: 'moncler',        lang: 'en', category: 'brand',   note: '몽클레어' },
  { keyword: 'canada goose',   lang: 'en', category: 'brand',   note: '캐나다구스' },
  { keyword: 'supreme',        lang: 'en', category: 'brand',   note: '슈프림' },
  { keyword: 'bape',           lang: 'en', category: 'brand',   note: '베이프' },
  { keyword: 'off-white',      lang: 'en', category: 'brand',   note: '오프화이트' },
  { keyword: 'off white',      lang: 'en', category: 'brand',   note: '오프화이트' },
  { keyword: 'stone island',   lang: 'en', category: 'brand',   note: '스톤아일랜드' },
  { keyword: 'nike',           lang: 'en', category: 'brand',   note: '나이키' },
  { keyword: 'adidas',         lang: 'en', category: 'brand',   note: '아디다스' },
  { keyword: 'yeezy',          lang: 'en', category: 'brand',   note: '이지' },
  { keyword: 'air jordan',     lang: 'en', category: 'brand',   note: '에어조던' },
  { keyword: 'jordan',         lang: 'en', category: 'brand',   note: '조던' },
  // CN
  { keyword: '古驰',   lang: 'cn', category: 'brand',   note: '구찌 CN' },
  { keyword: '路易威登', lang: 'cn', category: 'brand', note: '루이비통 CN' },
  { keyword: '香奈儿', lang: 'cn', category: 'brand',   note: '샤넬 CN' },
  { keyword: '普拉达', lang: 'cn', category: 'brand',   note: '프라다 CN' },
  { keyword: '爱马仕', lang: 'cn', category: 'brand',   note: '에르메스 CN' },
  { keyword: '巴黎世家', lang: 'cn', category: 'brand', note: '발렌시아가 CN' },
  { keyword: '迪奥',   lang: 'cn', category: 'brand',   note: '디올 CN' },
  { keyword: '范思哲', lang: 'cn', category: 'brand',   note: '베르사체 CN' },
  { keyword: '博柏利', lang: 'cn', category: 'brand',   note: '버버리 CN' },
  { keyword: '纪梵希', lang: 'cn', category: 'brand',   note: '지방시 CN' },
  { keyword: '芬迪',   lang: 'cn', category: 'brand',   note: '펜디 CN' },
  { keyword: '耐克',   lang: 'cn', category: 'brand',   note: '나이키 CN' },
  { keyword: '阿迪达斯', lang: 'cn', category: 'brand', note: '아디다스 CN' },
  { keyword: '椰子',   lang: 'cn', category: 'brand',   note: '이지 CN' },
  { keyword: '乔丹',   lang: 'cn', category: 'brand',   note: '조던 CN' },
  { keyword: '潮牌',   lang: 'cn', category: 'generic', note: '해외 스트리트 브랜드 통칭' },
  // KR
  { keyword: '구찌',       lang: 'kr', category: 'brand',   note: null },
  { keyword: '루이비통',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '샤넬',       lang: 'kr', category: 'brand',   note: null },
  { keyword: '프라다',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '에르메스',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '발렌시아가', lang: 'kr', category: 'brand',   note: null },
  { keyword: '디올',       lang: 'kr', category: 'brand',   note: null },
  { keyword: '베르사체',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '버버리',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '지방시',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '발렌티노',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '펜디',       lang: 'kr', category: 'brand',   note: null },
  { keyword: '셀린느',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '보테가베네타', lang: 'kr', category: 'brand', note: null },
  { keyword: '몽클레어',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '캐나다구스', lang: 'kr', category: 'brand',   note: null },
  { keyword: '슈프림',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '오프화이트', lang: 'kr', category: 'brand',   note: null },
  { keyword: '스톤아일랜드', lang: 'kr', category: 'brand', note: null },
  { keyword: '나이키',     lang: 'kr', category: 'brand',   note: null },
  { keyword: '아디다스',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '이지부스트', lang: 'kr', category: 'brand',   note: null },
  { keyword: '에어조던',   lang: 'kr', category: 'brand',   note: null },
  { keyword: '레플리카',   lang: 'kr', category: 'generic', note: '복제품 표현' },
  { keyword: '짝퉁',       lang: 'kr', category: 'generic', note: '복제품 표현' },
  { keyword: '고퀄',       lang: 'kr', category: 'generic', note: '고품질 복제품 표현' },
  { keyword: 'aaa급',      lang: 'all', category: 'generic', note: '복제품 등급 표현' },
  { keyword: '1:1',        lang: 'all', category: 'generic', note: '1:1 복제품 표현' },
  { keyword: '복제품',     lang: 'kr', category: 'generic', note: '복제품 직접 표현' },
  { keyword: '仿品',       lang: 'cn', category: 'generic', note: '복제품 CN' },
  { keyword: '高仿',       lang: 'cn', category: 'generic', note: '고퀄 복제품 CN' },
  { keyword: '精仿',       lang: 'cn', category: 'generic', note: '정밀 복제품 CN' },
  { keyword: '完美复刻',   lang: 'cn', category: 'generic', note: '완벽 복제 CN' },
]

const { data, error: insertErr } = await supabase
  .from('trademark_blocks')
  .upsert(brands, { onConflict: 'keyword' })
  .select('id')

if (insertErr) {
  console.log('✗ 삽입 오류:', insertErr.message)
} else {
  console.log(`✓ ${data?.length ?? brands.length}개 브랜드 키워드 삽입/업데이트 완료`)
}

// ── STEP 4: 완료 확인 ───────────────────────────────────────
console.log('\n[4/4] 최종 확인...')
const { data: totalBlocks, error: cntErr } = await supabase
  .from('trademark_blocks')
  .select('id', { count: 'exact', head: true })

console.log(`✓ trademark_blocks 총 ${totalBlocks === null ? '?' : '확인됨'} 건`)
if (!cntErr) console.log('\n✅ 완료! 브랜드 차단 키워드가 DB에 등록됐습니다.')

// products 테이블 총 수
const { count: productCount } = await supabase
  .from('products')
  .select('id', { count: 'exact', head: true })
  .eq('trademark_status', 'pending')

console.log(`   pending 상품: ${productCount ?? 0}개 (파이프라인 대기 중)`)
