import { NextRequest, NextResponse } from 'next/server'
import { sendKakaoAlimtalk } from '@/lib/notify/kakao'
import { sendSms } from '@/lib/notify/sms'
import { createServiceClient } from '@/lib/supabase/server'

const TEMPLATES: Record<string, { code: string; vars: string[] }> = {
  order_confirm: { code: 'ORDER_CONFIRM', vars: ['order_number', 'total_krw'] },
  shipping_start: { code: 'SHIP_START', vars: ['order_number', 'tracking_carrier', 'tracking_number'] },
  arrival: { code: 'ARRIVAL', vars: ['order_number'] },
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const { order_id, type, channel = 'kakao' } = await req.json()

  const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single()
  if (!order) return NextResponse.json({ error: '주문 없음' }, { status: 404 })

  const template = TEMPLATES[type]
  if (!template) return NextResponse.json({ error: '알 수 없는 알림 유형' }, { status: 400 })

  const variables = Object.fromEntries(
    template.vars.map(v => [v, String(order[v] ?? '')])
  )

  let success = false
  let content = ''

  try {
    if (channel === 'kakao') {
      await sendKakaoAlimtalk({ receiver: order.customer_phone, templateCode: template.code, variables })
      content = `카카오 알림: ${type}`
    } else {
      const msg = Object.entries(variables).map(([k, v]) => `${k}: ${v}`).join(', ')
      await sendSms(order.customer_phone, msg)
      content = `SMS: ${type}`
    }
    success = true
  } catch (err) {
    console.error('알림 발송 실패:', err)
  }

  await supabase.from('notification_logs').insert({
    order_id,
    type,
    channel,
    recipient: order.customer_phone,
    content,
    success,
    sent_at: new Date().toISOString(),
  })

  return NextResponse.json({ success })
}
