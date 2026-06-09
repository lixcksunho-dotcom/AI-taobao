import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const format   = searchParams.get('format') ?? 'general'   // 'general' | 'smartstore' | 'coupang'
  const status   = searchParams.get('status') ?? 'passed'
  const category = searchParams.get('category') ?? ''

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = sb
    .from('products')
    .select('taobao_id, taobao_url, title_cn, title_kr, price_cny, price_krw, images, keywords_kr, options_kr, source, category')
    .eq('trademark_status', status)
    .eq('stock_status', 'available')
    .limit(1000)

  if (category) query = (query as ReturnType<typeof query.eq>).eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = data ?? []
  let csv = ''

  if (format === 'smartstore') {
    // 스마트스토어 양식
    const headers = ['상품번호', '상품명', '판매가', '카테고리', '키워드', '이미지1', '이미지2', '이미지3', '원문URL']
    csv = headers.join(',') + '\n'
    csv += products.map((p, i) => [
      i + 1,
      `"${(p.title_kr ?? p.title_cn ?? '').replace(/"/g, '""')}"`,
      p.price_krw ?? '',
      `"${p.category ?? ''}"`,
      `"${(p.keywords_kr as string[] | null)?.join(' ') ?? ''}"`,
      (p.images as string[] | null)?.[0] ?? '',
      (p.images as string[] | null)?.[1] ?? '',
      (p.images as string[] | null)?.[2] ?? '',
      p.taobao_url ?? '',
    ].join(',')).join('\n')

  } else if (format === 'coupang') {
    // 쿠팡 양식
    const headers = ['노출상품명', '실제상품명', '판매가', '옵션종류명1', '옵션값1', '이미지1', '출처URL']
    csv = headers.join(',') + '\n'
    csv += products.map(p => {
      const opts = (p.options_kr as { type: string; values: string[] }[] | null) ?? []
      const optType  = opts[0]?.type ?? ''
      const optVals  = opts[0]?.values?.join('|') ?? ''
      return [
        `"${(p.title_kr ?? p.title_cn ?? '').replace(/"/g, '""')}"`,
        `"${(p.title_kr ?? p.title_cn ?? '').replace(/"/g, '""')}"`,
        p.price_krw ?? '',
        `"${optType}"`,
        `"${optVals}"`,
        (p.images as string[] | null)?.[0] ?? '',
        p.taobao_url ?? '',
      ].join(',')
    }).join('\n')

  } else {
    // 기본 형식
    const headers = ['ID', '한국어제목', '중국어제목', '원가(CNY)', '판매가(KRW)', '키워드', '이미지', '원문URL', '소스']
    csv = headers.join(',') + '\n'
    csv += products.map(p => [
      p.taobao_id,
      `"${(p.title_kr ?? '').replace(/"/g, '""')}"`,
      `"${(p.title_cn ?? '').replace(/"/g, '""')}"`,
      p.price_cny ?? '',
      p.price_krw ?? '',
      `"${(p.keywords_kr as string[] | null)?.join(' ') ?? ''}"`,
      (p.images as string[] | null)?.[0] ?? '',
      p.taobao_url ?? '',
      p.source ?? '',
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
