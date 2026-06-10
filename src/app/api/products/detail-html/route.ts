import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildDetailHtml, type DetailProduct } from '@/lib/detail-html'

// 단일 상품의 업로드용 상세페이지 HTML 반환
// ?id=<uuid>            → HTML 문자열(text/html)
// ?id=<uuid>&format=json → { html } JSON (클립보드 복사용)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const asJson = searchParams.get('format') === 'json'
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('products')
    .select('title_cn, title_kr, category, keywords_kr, options, options_kr, images')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message ?? '없음' }, { status: 404 })

  const html = buildDetailHtml(data as DetailProduct)
  if (asJson) return NextResponse.json({ html })
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
