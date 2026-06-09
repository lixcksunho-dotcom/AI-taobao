import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { searchAliexpress } from '@/lib/aliexpress'

export async function POST(req: NextRequest) {
  const { keyword, pages = 5, category = '' } = await req.json()
  if (!keyword) return NextResponse.json({ error: '키워드 필요' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const rate   = parseFloat(process.env.CNY_TO_KRW_RATE ?? '190')
  const margin = parseFloat(process.env.MARGIN_RATE ?? '1.3')
  const calcKrw = (usd: number) => Math.ceil(usd * 1350 * margin / 100) * 100

  let totalSaved = 0

  for (let p = 1; p <= pages; p++) {
    try {
      const products = await searchAliexpress(keyword, p, 50)
      if (products.length === 0) continue

      const rows = products.map(pr => ({
        taobao_id:    pr.taobao_id,
        taobao_url:   pr.taobao_url,
        title_cn:     pr.title_cn,
        title_kr:     null,
        price_cny:    null,
        price_krw:    pr.price_krw,
        images:       pr.images,
        options:      [],
        stock_status: 'available',
        category:     category || null,
        source:       'aliexpress',
        scraped_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }))

      const { data } = await supabase
        .from('products')
        .upsert(rows, { onConflict: 'taobao_id' })
        .select('id')

      totalSaved += data?.length ?? rows.length
    } catch (err) {
      console.error(`[aliexpress] 페이지 ${p} 오류:`, err)
    }
  }

  return NextResponse.json({ totalSaved, keyword, pages })
}
