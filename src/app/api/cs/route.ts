import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  let query = sb()
    .from('cs_tickets')
    .select('*, orders(order_number, status, tracking_number)')
    .order('created_at', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (status) query = (query as any).eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 새 CS 접수
export async function POST(req: NextRequest) {
  const { customer_name, customer_contact, category, message, order_id } = await req.json()
  if (!customer_name || !message) {
    return NextResponse.json({ error: '이름과 문의 내용 필수' }, { status: 400 })
  }

  const { data, error } = await sb()
    .from('cs_tickets')
    .insert({ customer_name, customer_contact, category: category ?? 'other', message, order_id: order_id ?? null, status: 'open' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 상태·답변 수정
export async function PATCH(req: NextRequest) {
  const { id, status, ai_response, admin_response } = await req.json()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status !== undefined)         update.status         = status
  if (ai_response !== undefined)    update.ai_response    = ai_response
  if (admin_response !== undefined) update.admin_response = admin_response

  const { data, error } = await sb()
    .from('cs_tickets').update(update).eq('id', id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
