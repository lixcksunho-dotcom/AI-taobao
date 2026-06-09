import { NextRequest, NextResponse } from 'next/server'
import { scrapeTaobaoProduct } from '@/lib/scraper/taobao'
import { translateProductTitle, calculateKrwPrice } from '@/lib/ai/translate'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const { url, save = true } = await req.json()
    if (!url) return NextResponse.json({ error: 'url 필요' }, { status: 400 })

    const product = await scrapeTaobaoProduct(url)
    const title_kr = await translateProductTitle(product.title_cn)
    const price_krw = calculateKrwPrice(product.price_cny)

    const result = { ...product, title_kr, price_krw }

    if (save) {
      const supabase = createServiceClient()
      await supabase.from('products').upsert({
        taobao_id: product.taobao_id,
        taobao_url: product.taobao_url,
        title_cn: product.title_cn,
        title_kr,
        price_cny: product.price_cny,
        price_krw,
        images: product.images,
        options: product.options,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'taobao_id' })
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '스크래핑 실패'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
