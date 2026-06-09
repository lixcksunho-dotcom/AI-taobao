import { NextRequest } from 'next/server'
import { scrapeSearchPage } from '@/lib/scraper/search'
import { calculateKrwPrice } from '@/lib/ai/translate'
import { createServiceClient } from '@/lib/supabase/server'

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(data) + '\n\n'))
}

export async function POST(req: NextRequest) {
  const { keyword, pages = 3, category = '', source = 'auto' } = await req.json()
  if (!keyword) {
    return new Response('keyword 필요', { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const supabase = createServiceClient()
      let totalSaved = 0
      let totalSkipped = 0

      send(controller, { type: 'start', keyword, pages })

      for (let page = 1; page <= pages; page++) {
        try {
          send(controller, { type: 'progress', page, pages, saved: totalSaved })

          const products = await scrapeSearchPage(keyword, page, source)

          if (products.length === 0) {
            send(controller, { type: 'warn', message: `페이지 ${page}: 상품 없음 (로그인 필요 또는 봇 감지)` })
            // 빈 결과면 조기 종료
            if (page === 1) break
            continue
          }

          // 가격 계산 후 일괄 저장
          const rows = products.map(p => ({
            taobao_id: p.taobao_id,
            taobao_url: p.taobao_url,
            title_cn: p.title_cn,
            title_kr: null,          // 번역은 나중에 별도 처리
            price_cny: p.price_cny,
            price_krw: calculateKrwPrice(p.price_cny),
            images: p.images,
            options: [],
            stock_status: 'available',
            category: category || null,
            scraped_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }))

          const { data, error } = await supabase
            .from('products')
            .upsert(rows, { onConflict: 'taobao_id', ignoreDuplicates: false })
            .select('id')

          if (error) {
            send(controller, { type: 'error', page, message: error.message })
          } else {
            const saved = data?.length ?? rows.length
            totalSaved += saved
            totalSkipped += rows.length - saved
            send(controller, {
              type: 'page_done',
              page,
              pages,
              count: products.length,
              saved: totalSaved,
            })
          }

          // 페이지 간 딜레이 (봇 감지 방지)
          if (page < pages) {
            await new Promise(r => setTimeout(r, 2500 + Math.random() * 2000))
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '알 수 없는 오류'
          send(controller, { type: 'error', page, message: msg })
          // 타임아웃이나 봇 감지면 잠시 쉬고 계속
          await new Promise(r => setTimeout(r, 5000))
        }
      }

      send(controller, {
        type: 'done',
        totalSaved,
        totalSkipped,
        keyword,
        pages,
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
