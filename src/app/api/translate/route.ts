import { NextRequest, NextResponse } from 'next/server'
import { translateProductTitle, calculateKrwPrice } from '@/lib/ai/translate'

export async function POST(req: NextRequest) {
  try {
    const { title_cn, price_cny, rate, margin_rate } = await req.json()
    const title_kr = await translateProductTitle(title_cn)
    const price_krw = calculateKrwPrice(price_cny, rate, margin_rate)
    return NextResponse.json({ title_kr, price_krw })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '번역 실패'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
