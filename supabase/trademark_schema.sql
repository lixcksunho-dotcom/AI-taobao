-- 상표권/지재권 차단 키워드 테이블
CREATE TABLE IF NOT EXISTS trademark_blocks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword     TEXT NOT NULL UNIQUE,
  lang        TEXT NOT NULL DEFAULT 'all',   -- 'cn' | 'kr' | 'en' | 'all'
  category    TEXT NOT NULL DEFAULT 'brand', -- 'brand' | 'generic' | 'custom'
  note        TEXT,
  block_count INT  NOT NULL DEFAULT 0,       -- 이 키워드로 차단된 상품 수
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 차단 브랜드 목록 삽입
INSERT INTO trademark_blocks (keyword, lang, category, note) VALUES
  -- 명품 (EN)
  ('gucci',             'en', 'brand', '구찌'),
  ('louis vuitton',     'en', 'brand', '루이비통'),
  ('lv',                'en', 'brand', '루이비통 약자'),
  ('chanel',            'en', 'brand', '샤넬'),
  ('prada',             'en', 'brand', '프라다'),
  ('hermes',            'en', 'brand', '에르메스'),
  ('hermès',            'en', 'brand', '에르메스'),
  ('dior',              'en', 'brand', '디올'),
  ('balenciaga',        'en', 'brand', '발렌시아가'),
  ('versace',           'en', 'brand', '베르사체'),
  ('burberry',          'en', 'brand', '버버리'),
  ('givenchy',          'en', 'brand', '지방시'),
  ('valentino',         'en', 'brand', '발렌티노'),
  ('fendi',             'en', 'brand', '펜디'),
  ('celine',            'en', 'brand', '셀린느'),
  ('bottega veneta',    'en', 'brand', '보테가베네타'),
  ('moncler',           'en', 'brand', '몽클레어'),
  ('canada goose',      'en', 'brand', '캐나다구스'),
  -- 스트리트 (EN)
  ('supreme',           'en', 'brand', '슈프림'),
  ('bape',              'en', 'brand', '베이프'),
  ('a bathing ape',     'en', 'brand', '베이프 정식명'),
  ('off-white',         'en', 'brand', '오프화이트'),
  ('off white',         'en', 'brand', '오프화이트'),
  ('palace',            'en', 'brand', '팔라스'),
  ('stone island',      'en', 'brand', '스톤아일랜드'),
  ('vetements',         'en', 'brand', '베트멍'),
  -- 스포츠 (EN)
  ('nike',              'en', 'brand', '나이키'),
  ('adidas',            'en', 'brand', '아디다스'),
  ('yeezy',             'en', 'brand', '이지'),
  ('air jordan',        'en', 'brand', '에어조던'),
  ('jordan',            'en', 'brand', '조던'),
  -- 명품 (중국어)
  ('古驰',              'cn', 'brand', '구찌 CN'),
  ('路易威登',           'cn', 'brand', '루이비통 CN'),
  ('香奈儿',            'cn', 'brand', '샤넬 CN'),
  ('普拉达',            'cn', 'brand', '프라다 CN'),
  ('爱马仕',            'cn', 'brand', '에르메스 CN'),
  ('巴黎世家',           'cn', 'brand', '발렌시아가 CN'),
  ('迪奥',              'cn', 'brand', '디올 CN'),
  ('范思哲',            'cn', 'brand', '베르사체 CN'),
  ('博柏利',            'cn', 'brand', '버버리 CN'),
  ('纪梵希',            'cn', 'brand', '지방시 CN'),
  ('芬迪',              'cn', 'brand', '펜디 CN'),
  -- 스포츠 (중국어)
  ('耐克',              'cn', 'brand', '나이키 CN'),
  ('阿迪达斯',           'cn', 'brand', '아디다스 CN'),
  ('椰子',              'cn', 'brand', '이지(코코넛) CN'),
  ('乔丹',              'cn', 'brand', '조던 CN'),
  -- 스트리트 (중국어)
  ('潮牌',              'cn', 'generic', '해외 스트리트 브랜드 통칭'),
  -- 명품 (한국어)
  ('구찌',              'kr', 'brand', NULL),
  ('루이비통',           'kr', 'brand', NULL),
  ('샤넬',              'kr', 'brand', NULL),
  ('프라다',            'kr', 'brand', NULL),
  ('에르메스',           'kr', 'brand', NULL),
  ('발렌시아가',         'kr', 'brand', NULL),
  ('디올',              'kr', 'brand', NULL),
  ('베르사체',           'kr', 'brand', NULL),
  ('버버리',            'kr', 'brand', NULL),
  ('지방시',            'kr', 'brand', NULL),
  ('발렌티노',           'kr', 'brand', NULL),
  ('펜디',              'kr', 'brand', NULL),
  ('셀린느',            'kr', 'brand', NULL),
  ('보테가베네타',       'kr', 'brand', NULL),
  ('몽클레어',           'kr', 'brand', NULL),
  ('캐나다구스',         'kr', 'brand', NULL),
  -- 스트리트 (한국어)
  ('슈프림',            'kr', 'brand', NULL),
  ('오프화이트',         'kr', 'brand', NULL),
  ('스톤아일랜드',       'kr', 'brand', NULL),
  -- 스포츠 (한국어)
  ('나이키',            'kr', 'brand', NULL),
  ('아디다스',           'kr', 'brand', NULL),
  ('이지부스트',         'kr', 'brand', NULL),
  ('에어조던',           'kr', 'brand', NULL),
  -- 짝퉁 표현 (한국어/중국어)
  ('레플리카',           'kr', 'generic', '복제품 표현'),
  ('짝퉁',              'kr', 'generic', '복제품 표현'),
  ('고퀄',              'kr', 'generic', '고품질 복제품 표현'),
  ('AAA급',             'all', 'generic', '복제품 등급 표현'),
  ('1:1',               'all', 'generic', '1:1 복제품 표현'),
  ('복제품',            'kr', 'generic', '복제품 직접 표현'),
  ('仿品',              'cn', 'generic', '복제품 CN'),
  ('高仿',              'cn', 'generic', '고퀄 복제품 CN'),
  ('精仿',              'cn', 'generic', '정밀 복제품 CN'),
  ('完美复刻',           'cn', 'generic', '완벽 복제 CN')
ON CONFLICT (keyword) DO NOTHING;

-- products 테이블에 파이프라인 관련 컬럼 추가
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS trademark_status  TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS trademark_blocked_by TEXT,
  ADD COLUMN IF NOT EXISTS keywords_cn       TEXT[],
  ADD COLUMN IF NOT EXISTS keywords_kr       TEXT[],
  ADD COLUMN IF NOT EXISTS options_kr        JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS processed_at      TIMESTAMPTZ;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_products_trademark_status ON products(trademark_status);
CREATE INDEX IF NOT EXISTS idx_trademark_blocks_keyword  ON trademark_blocks(lower(keyword));
