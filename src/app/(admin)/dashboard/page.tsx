'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Stats {
  todayOrders: number
  totalRevenue: number
  pendingOrders: number
  openCs: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ todayOrders: 0, totalRevenue: 0, pendingOrders: 0, openCs: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchStats() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [todayOrdersRes, totalRevenueRes, pendingOrdersRes, openCsRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact' }).gte('created_at', today.toISOString()),
        supabase.from('orders').select('total_krw').eq('status', 'done'),
        supabase.from('orders').select('id', { count: 'exact' }).in('status', ['pending', 'paid']),
        supabase.from('cs_tickets').select('id', { count: 'exact' }).eq('status', 'open'),
      ])

      const totalRevenue = (totalRevenueRes.data ?? []).reduce((sum, o) => sum + (o.total_krw ?? 0), 0)

      setStats({
        todayOrders: todayOrdersRes.count ?? 0,
        totalRevenue,
        pendingOrders: pendingOrdersRes.count ?? 0,
        openCs: openCsRes.count ?? 0,
      })
      setLoading(false)
    }

    fetchStats()

    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_tickets' }, fetchStats)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const cards = [
    { label: '오늘 주문', value: stats.todayOrders, unit: '건', color: 'bg-blue-500' },
    { label: '총 매출', value: stats.totalRevenue.toLocaleString(), unit: '원', color: 'bg-green-500' },
    { label: '처리 대기', value: stats.pendingOrders, unit: '건', color: 'bg-yellow-500' },
    { label: '미답변 CS', value: stats.openCs, unit: '건', color: 'bg-red-500' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">대시보드</h1>
      {loading ? (
        <p className="text-gray-500">로딩 중...</p>
      ) : (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {cards.map(card => (
            <div key={card.label} className="rounded-xl shadow p-6 bg-white border">
              <div className={`w-10 h-10 rounded-lg ${card.color} mb-3`} />
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-3xl font-bold mt-1">
                {card.value}
                <span className="text-base font-normal text-gray-400 ml-1">{card.unit}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
