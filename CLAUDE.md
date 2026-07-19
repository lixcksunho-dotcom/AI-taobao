@AGENTS.md

# AI-taobao — 타오바오/1688 구매대행 자동화 플랫폼

## 개요
중국 소싱(1688/타오바오) → 지재권 검수 → 한국어 번역/이미지 가공 → 국내 오픈마켓(쿠팡/스마트스토어) 업로드용 데이터 산출까지의 파이프라인 + 관리자 웹.

**스택**: Next.js 16 (App Router) + React 19 + TypeScript + Supabase + Claude API(`@anthropic-ai/sdk`) + Playwright(stealth) + Python(이미지 가공)

## 구조

```
src/app/(admin)/   관리자 UI  dashboard, scraper, pipeline, products, orders, cs, trademark, settings
src/app/api/       서버 라우트 (service key 사용 — 브라우저 직접 조회 금지, 아래 RLS 규칙 참조)
src/lib/           ai/ scraper/ supabase/ notify/ + translate.ts trademark.ts detail-html.ts product-pipeline.ts aliexpress.ts
scripts/           수집·가공 CLI (아래 카탈로그)
```

## scripts 카탈로그 (실제 운영 흐름)

**수집**
- `session-login.mjs <taobao|1688>` — **최초 1회** 로그인해 `.chrome-profile`에 세션 저장. 이게 없으면 캡차로 전부 막힘.
- `scrape-1688.mjs "키워드" [페이지] [headed|headless]` — 1688 수집 (작동 검증됨)
- `scrape-taobao.mjs "키워드" [페이지]` — 타오바오 수집. `--dump`로 원본 응답 진단
- `verify-collection.mjs [--since N]` — 수집 결과 자동 판정 (PASS 0 / WARN 1 / FAIL 2)
- `scrape-auto.mjs` — **폐기됨** (레거시 URL, 이제 0건)

**보강**
- `scrape-detail.mjs <offerId>` / `scrape-options.mjs <id>|--all` — 1688 상세컷·옵션
- `enrich-taobao.mjs <itemId> | --all [N] | --force | --headed | --slow` — 타오바오 상세컷+옵션 (헤드갤러리·getdesc·skuBase 3곳 조합)
- `rehost-images.mjs` — 원본 이미지 → Supabase Storage `product-images` 버킷으로 재호스팅

**가공**
- `translate_image.py <in> <out> [--batch] [--smart|--raw]` — 이미지 속 중국어 → 한국어 렌더. 기본=풀번역, `--smart`=옵션차트만, `--raw`=품질필터만
- `process-product-images.mjs <offerId>` / `process-batch.mjs [N] [--force] [--smart]` — 종단 배치
- `translate-titles.mjs`, `generate-descriptions.mjs` — 제목/설명 한국어화
- `calc-pricing.mjs` — 판매가 = (원가KRW + 배송비) / (1 − 쿠팡수수료율 − 마진율), 100원 올림
- `check-trademark.mjs` — 브랜드/짝퉁 목록 대조 → `trademark_status`

## 반드시 알아야 할 함정 (모르면 시간 날림)

1. **1688/타오바오 검색은 정적 URL 파싱 불가.** 둘 다 2024 SPA 리뉴얼로 `mtop.relationrecommend.wirelessrecommend.recommend` 응답을 **가로채야** 한다.
   - 1688: 홈 검색창 UI 흐름 경유 필수 → `data.data.OFFER.items[].data` (~60건/페이지)
   - 타오바오: 반대로 홈 검색창은 프로모션 위젯만 잡힘 → **`s.taobao.com/search?q=&page=N` 직접 진입** 필수 → `data.itemsArray` (~48건/페이지)
2. **세션 없으면 캡차(验证码).** `.chrome-profile` persistent 세션이면 수 주 유지. headless + 무로그인 = 무조건 차단.
3. **타오바오 상세는 연속 요청 시 봇 차단(punish).** `--slow`(8~14s 간격) 사용, 차단되면 백오프 무효 → 수십 분~수 시간 쿨다운 또는 `--headed`로 수동 해결 1회.
4. **RLS**: 브라우저에서 publishable 키로 Supabase 직접 조회하면 **0건**. admin 페이지는 전부 `/api/*`(service key) 경유로 조회할 것.
5. **DDL은 service 키로 불가** (`exec_sql` RPC 없음) → 컬럼 추가는 Supabase SQL Editor에서 수동.
6. **`source` 컬럼은 존재하지 않음.** `taobao_id.startsWith('1688_') ? '1688' : 'taobao'`로 파생한다. 컬럼 추가하지 말 것.
7. **`category` 컬럼에 카테고리가 아니라 한국어 상세설명이 들어있음** (`description_kr` 컬럼 부재로 재사용된 것). `options`=번역 옵션(채워짐), `options_kr`=빈 컬럼.
8. **라틴 문자 워터마크 단독 제거 금지.** 상품 프린트(`Hello`, `PUSH` 등)를 오제거함. 한자 워터마크 + 그에 인접한 라틴만 제거.
9. `translate_image.py`는 번역 실패·한자 잔존 박스는 inpaint/렌더 모두 스킵 — 두부(口)를 절대 남기지 않는 설계.

## 명령어

```bash
npm run dev            # 개발 서버
npm run build          # 빌드 (변경 후 반드시 통과 확인)
npm run lint
npm run push           # scripts/push-to-github.mjs
node scripts/test-parse-1688.mjs      # 파서 회귀 테스트
node scripts/test-parse-taobao.mjs
```

## 환경변수 (`.env.local`, gitignore됨 — 절대 커밋 금지)
`NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` `ANTHROPIC_API_KEY` `CNY_TO_KRW_RATE` `SHIPPING_FEE_KRW` `COUPANG_FEE_RATE` `TARGET_MARGIN_RATE` `ALIEXPRESS_APP_KEY` `ALIEXPRESS_APP_SECRET` `ALIGO_*`

## 작업 규칙
- 코드 변경 후 `npm run build` 통과를 확인하고 보고할 것. 통과 못 했으면 그대로 말할 것.
- 스크래퍼 셰이프가 깨진 것 같으면 추측 말고 `--dump` / `diag-taobao.mjs`로 **실측 응답부터** 확보.
- 새 PC에서 시작할 땐 `.env.local`과 `.chrome-profile` 로그인이 있는지 먼저 확인 (둘 다 git에 없음).
