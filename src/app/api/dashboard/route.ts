import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// 대시보드 집계 — 브라우저 publishable 키는 RLS로 0이 나오므로 서비스 키로 서버 집계
export async function GET() {
  const supabase = createServiceClient()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const [
    todayOrd, pendingOrd, revRes, openCs,
    totalProd, passedProd, pendingPipe, blockedProd,
    recentOrd,
  ] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'paid', 'preparing']),
    supabase.from('orders').select('total_krw').eq('status', 'done'),
    supabase.from('cs_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('trademark_status', 'passed'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('trademark_status', 'pending'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('trademark_status', 'blocked'),
    supabase.from('orders').select('id, order_number, customer_name, status, total_krw, created_at')
      .order('created_at', { ascending: false }).limit(6),
  ])

  const totalRevenue = (revRes.data ?? []).reduce(
    (s: number, o: { total_krw: number | null }) => s + (o.total_krw ?? 0), 0)

  return NextResponse.json({
    stats: {
      todayOrders:     todayOrd.count    ?? 0,
      pendingOrders:   pendingOrd.count  ?? 0,
      totalRevenue,
      openCs:          openCs.count      ?? 0,
      totalProducts:   totalProd.count   ?? 0,
      passedProducts:  passedProd.count  ?? 0,
      pendingPipeline: pendingPipe.count ?? 0,
      blockedProducts: blockedProd.count ?? 0,
    },
    recentOrders: recentOrd.data ?? [],
  })
}
