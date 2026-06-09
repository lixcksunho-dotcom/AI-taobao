import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: NextRequest) {
  const { ticketId } = await req.json()
  if (!ticketId) return NextResponse.json({ error: 'ticketId 필요' }, { status: 400 })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 티켓 + 주문 정보 조회
  const { data: ticket, error } = await sb
    .from('cs_tickets')
    .select('*, orders(order_number, status, total_krw, tracking_number, created_at)')
    .eq('id', ticketId)
    .single()

  if (error || !ticket) return NextResponse.json({ error: '티켓 없음' }, { status: 404 })

  const order = ticket.orders as Record<string, unknown> | null
  const categoryMap: Record<string, string> = {
    shipping: '배송 문의', refund: '환불 요청', exchange: '교환 요청', other: '기타 문의',
  }

  const context = `
고객 이름: ${ticket.customer_name}
문의 유형: ${categoryMap[ticket.category] ?? ticket.category}
고객 문의 내용: ${ticket.message}
${order ? `
주문번호: ${order.order_number}
주문 상태: ${order.status}
결제 금액: ${Number(order.total_krw ?? 0).toLocaleString()}원
송장번호: ${order.tracking_number ?? '미발급'}
주문일: ${new Date(String(order.created_at)).toLocaleDateString('ko-KR')}
` : '주문 정보 없음'}`.trim()

  const client = new Anthropic()
  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `당신은 한국 온라인 쇼핑몰의 친절한 CS 담당자입니다.
아래 고객 문의에 대해 자연스럽고 공감 가는 한국어 답변을 작성하세요.

규칙:
- 정중하고 따뜻한 어조 (습니다체)
- 구체적인 도움 제공
- 200자 이내로 간결하게
- 인사말로 시작, 마무리 인사 포함
- 답변 텍스트만 출력 (안내문구 없이)

${context}`,
    }],
  })

  const aiReply = response.content[0].type === 'text' ? response.content[0].text : ''

  // DB에 AI 답변 저장
  await sb
    .from('cs_tickets')
    .update({ ai_response: aiReply, updated_at: new Date().toISOString() })
    .eq('id', ticketId)

  return NextResponse.json({ reply: aiReply })
}
