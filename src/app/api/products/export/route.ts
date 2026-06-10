import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildDetailHtml, pickOptions, type DetailProduct } from '@/lib/detail-html'

interface ExportProduct extends DetailProduct {
  taobao_id?: string | null
  taobao_url?: string | null
  price_cny?: number | null
  price_krw?: number | null
}

// CSV 셀 이스케이프(쉼표·따옴표·줄바꿈 포함 값을 안전하게 감싼다)
function cell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') ?? 'general'   // 'general' | 'smartstore' | 'coupang'
  const status = searchParams.get('status') ?? 'passed'

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // category 컬럼은 실제로 한국어 상세설명 본문을 담고 있음(description_kr 부재로 재사용)
  const { data, error } = await sb
    .from('products')
    .select('taobao_id, taobao_url, title_cn, title_kr, price_cny, price_krw, images, keywords_kr, options, options_kr, category')
    .eq('trademark_status', status)
    .eq('stock_status', 'available')
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = (data ?? []) as ExportProduct[]
  let csv = ''

  if (format === 'smartstore') {
    // 스마트스토어 양식 — 카테고리는 업로드 시 직접 매핑하므로 공란, 상세설명은 번역 상세컷 포함 HTML
    const headers = ['상품번호', '상품명', '판매가', '카테고리', '키워드', '대표이미지', '상세설명(HTML)', '원문URL']
    csv = headers.join(',') + '\n'
    csv += products.map((p, i) => [
      cell(i + 1),
      cell(p.title_kr ?? p.title_cn ?? ''),
      cell(p.price_krw ?? ''),
      '',  // 카테고리: 스마트스토어 UI에서 매핑
      cell((p.keywords_kr as string[] | null)?.join(' ') ?? ''),
      cell((p.images as string[] | null)?.[0] ?? ''),
      cell(buildDetailHtml(p)),
      cell(p.taobao_url ?? ''),
    ].join(',')).join('\n')

  } else if (format === 'coupang') {
    // 쿠팡 양식 — 옵션은 채워진 컬럼(options) 사용, 색상·사이즈 2개 그룹까지
    const headers = ['노출상품명', '실제상품명', '판매가', '옵션종류명1', '옵션값1', '옵션종류명2', '옵션값2', '대표이미지', '상세설명(HTML)', '출처URL']
    csv = headers.join(',') + '\n'
    csv += products.map(p => {
      const opts = pickOptions(p)
      const name = p.title_kr ?? p.title_cn ?? ''
      return [
        cell(name),
        cell(name),
        cell(p.price_krw ?? ''),
        cell(opts[0]?.type ?? ''),
        cell(opts[0]?.values?.join('|') ?? ''),
        cell(opts[1]?.type ?? ''),
        cell(opts[1]?.values?.join('|') ?? ''),
        cell((p.images as string[] | null)?.[0] ?? ''),
        cell(buildDetailHtml(p)),
        cell(p.taobao_url ?? ''),
      ].join(',')
    }).join('\n')

  } else {
    // 기본 형식
    const headers = ['ID', '한국어제목', '중국어제목', '원가(CNY)', '판매가(KRW)', '키워드', '이미지', '원문URL', '소스']
    csv = headers.join(',') + '\n'
    csv += products.map(p => [
      cell(p.taobao_id ?? ''),
      cell(p.title_kr ?? ''),
      cell(p.title_cn ?? ''),
      cell(p.price_cny ?? ''),
      cell(p.price_krw ?? ''),
      cell((p.keywords_kr as string[] | null)?.join(' ') ?? ''),
      cell((p.images as string[] | null)?.[0] ?? ''),
      cell(p.taobao_url ?? ''),
      (p.taobao_id ?? '').startsWith('1688_') ? '1688' : 'taobao',  // source는 ID 접두사에서 파생
    ].join(',')).join('\n')
  }

  const filename = `products_${format}_${new Date().toISOString().slice(0, 10)}.csv`
  const bom      = '﻿' // UTF-8 BOM (엑셀 한글 깨짐 방지)

  return new NextResponse(bom + csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
