import { NextRequest } from 'next/server'
import { processSingleProduct, processPending } from '@/lib/product-pipeline'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { productId, mode = 'single', limit = 50 } = await req.json()

  const encoder = new TextEncoder()
  const stream  = new TransformStream<Uint8Array, Uint8Array>()
  const writer  = stream.writable.getWriter()

  function send(data: object) {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // 비동기로 처리 시작
  ;(async () => {
    try {
      if (mode === 'single' && productId) {
        await processSingleProduct(productId, send)
      } else {
        send({ type: 'start', message: `pending 상품 최대 ${limit}개 처리 시작` })
        const result = await processPending(limit, send)
        send({ type: 'summary', ...result })
      }
    } catch (err) {
      send({ type: 'error', message: (err as Error).message })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
