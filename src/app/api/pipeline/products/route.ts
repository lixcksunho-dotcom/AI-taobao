import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'pending'
  const limit  = parseInt(searchParams.get('limit') ?? '100', 10)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('products')
    .select('id, taobao_id, title_cn, title_kr, trademark_status, trademark_blocked_by, processed_at, price_krw')
    .eq('trademark_status', status)
    .order('scraped_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // source는 별도 컬럼 없이 ID 접두사에서 파생
  const products = (data ?? []).map(p => ({
    ...p,
    source: p.taobao_id?.startsWith('1688_') ? '1688' : 'taobao',
  }))
  return NextResponse.json({ products })
}
