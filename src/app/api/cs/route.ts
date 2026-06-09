import { NextRequest, NextResponse } from 'next/server'
import { handleCsTicket } from '@/lib/ai/cs-agent'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const { order_id, customer_name, customer_contact, message } = await req.json()

  // 주문 정보 조회
  let orderInfo
  if (order_id) {
    const { data } = await supabase.from('orders').select('*').eq('id', order_id).single()
    orderInfo = data
  }

  const result = await handleCsTicket(message, orderInfo)

  const { data, error } = await supabase
    .from('cs_tickets')
    .insert({
      order_id: order_id ?? null,
      customer_name,
      customer_contact,
      category: result.category,
      message,
      ai_response: result.ai_response,
      status: result.is_escalated ? 'in_progress' : 'open',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ...data, is_escalated: result.is_escalated })
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  let query = supabase.from('cs_tickets').select('*, orders(order_number)').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
