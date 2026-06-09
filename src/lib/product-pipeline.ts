/**
 * 상품 처리 파이프라인
 *
 * 스크래핑 → ①지재권체크(CN) → 차단이면 삭제
 *           → ②번역(CN→KR)
 *           → ③지재권체크(KR) → 해당 단어만 제거
 *           → DB 업데이트 (trademark_status = 'passed')
 */

import { createClient } from '@supabase/supabase-js'
import { checkTrademark, sanitizeText, sanitizeKeywords, incrementBlockCount } from './trademark'
import { translateProduct } from './translate'

export type PipelineStatus = 'pending' | 'processing' | 'passed' | 'blocked' | 'error'

export interface PipelineEvent {
  type:       'start' | 'check_cn' | 'translate' | 'check_kr' | 'done' | 'blocked' | 'error'
  productId?: string
  title?:     string
  message?:   string
  matched?:   string[]
}

type Emitter = (event: PipelineEvent) => void

function makeSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ────────────────────────────────────────
// 단일 상품 처리
// ────────────────────────────────────────
export async function processSingleProduct(
  productId: string,
  emit?: Emitter
): Promise<PipelineStatus> {
  const sb = makeSupabase()
  const send = emit ?? (() => {})

  const { data: product, error } = await sb
    .from('products')
    .select('id, title_cn, title_kr, options, keywords_cn, trademark_status')
    .eq('id', productId)
    .single()

  if (error || !product) {
    send({ type: 'error', productId, message: '상품 조회 실패' })
    return 'error'
  }

  // 이미 처리됐으면 건너뜀
  if (product.trademark_status === 'passed' || product.trademark_status === 'blocked') {
    send({ type: 'done', productId, title: product.title_cn, message: '이미 처리됨' })
    return product.trademark_status as PipelineStatus
  }

  // processing 표시
  await sb.from('products').update({ trademark_status: 'processing' }).eq('id', productId)
  send({ type: 'start', productId, title: product.title_cn })

  // ── STEP 1: 중국어 지재권 체크 ──────────────────
  send({ type: 'check_cn', productId, title: product.title_cn })

  const cnKeywords: string[] = product.keywords_cn ?? []
  const cnFullText = [product.title_cn, ...cnKeywords].join(' ')
  const cnCheck    = await checkTrademark(cnFullText, 'cn')

  if (cnCheck.blocked) {
    await incrementBlockCount(cnCheck.matched)
    await sb.from('products').update({
      trademark_status:     'blocked',
      trademark_blocked_by: cnCheck.matched.join(', '),
    }).eq('id', productId)
    send({ type: 'blocked', productId, title: product.title_cn, matched: cnCheck.matched })
    return 'blocked'
  }

  // ── STEP 2: 번역 ──────────────────────────────
  send({ type: 'translate', productId, title: product.title_cn })

  let titleKr    = product.title_kr ?? ''
  let keywordsKr: string[] = []
  let optionsKr: { type: string; values: string[] }[] = []

  try {
    const translated = await translateProduct(
      product.title_cn,
      cnKeywords,
      (product.options as { type: string; values: string[] }[]) ?? []
    )
    titleKr    = translated.title_kr
    keywordsKr = translated.keywords_kr
    optionsKr  = translated.options_kr
  } catch (err) {
    // 번역 실패해도 진행 (기존 제목 사용)
    send({ type: 'error', productId, message: `번역 오류: ${(err as Error).message}` })
  }

  // ── STEP 3: 한국어 지재권 체크 + 단어 제거 ────
  send({ type: 'check_kr', productId, title: titleKr })

  const krCheck = await checkTrademark(titleKr + ' ' + keywordsKr.join(' '), 'kr')
  if (krCheck.matched.length > 0) {
    titleKr    = await sanitizeText(titleKr, 'kr')
    keywordsKr = await sanitizeKeywords(keywordsKr, 'kr')
    await incrementBlockCount(krCheck.matched)
  }

  // 영문도 체크
  const enCheck = await checkTrademark(titleKr + ' ' + keywordsKr.join(' '), 'en')
  if (enCheck.matched.length > 0) {
    titleKr    = await sanitizeText(titleKr, 'en')
    keywordsKr = await sanitizeKeywords(keywordsKr, 'en')
  }

  // ── 최종 업데이트 ─────────────────────────────
  await sb.from('products').update({
    title_kr:          titleKr,
    keywords_kr:       keywordsKr,
    options_kr:        optionsKr,
    trademark_status:  'passed',
    trademark_blocked_by: null,
    processed_at:      new Date().toISOString(),
  }).eq('id', productId)

  send({ type: 'done', productId, title: titleKr })
  return 'passed'
}

// ────────────────────────────────────────
// 대량 처리 (pending 상품 모두)
// ────────────────────────────────────────
export async function processPending(
  limit = 50,
  emit?: Emitter
): Promise<{ passed: number; blocked: number; errors: number }> {
  const sb = makeSupabase()

  const { data: products } = await sb
    .from('products')
    .select('id')
    .eq('trademark_status', 'pending')
    .limit(limit)

  if (!products?.length) return { passed: 0, blocked: 0, errors: 0 }

  let passed = 0, blocked = 0, errors = 0

  for (const p of products) {
    const status = await processSingleProduct(p.id, emit).catch(() => 'error' as PipelineStatus)
    if (status === 'passed')  passed++
    if (status === 'blocked') blocked++
    if (status === 'error')   errors++
    // 짧은 딜레이 (Claude API rate limit 방지)
    await new Promise(r => setTimeout(r, 300))
  }

  return { passed, blocked, errors }
}
