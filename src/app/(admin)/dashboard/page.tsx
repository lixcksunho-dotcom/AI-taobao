'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Stats {
  todayOrders:   number
  pendingOrders: number
  totalRevenue:  number
  openCs:        number
  totalProducts: number
  passedProducts:  number
  pendingPipeline: number
  blockedProducts: number
}

interface RecentOrder {
  id:           string
  order_number: string
  customer_name: string
  status:       string
  total_krw:    number
  created_at:   string
}

const STATUS_KR: Record<string, string> = {
  pending: '결제대기', paid: '결제완료', preparing: '상품준비',
  shipped: '배송중', done: '완료', cancelled: '취소',
}
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', paid: 'bg-blue-100 text-blue-700',
  preparing: 'bg-yellow-100 text-yellow-700', shipped: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
}

export default function DashboardPage() {
  const [stats,        setStats]        = useState<Stats | null>(null)
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    let alive = true

    // RLS 우회: 서버 API(service 키)로 집계 조회. 실시간 대신 30초 폴링
    async function fetchAll() {
      try {
        const res = await fetch('/api/dashboard')
        if (!res.ok) return
        const data = await res.json()
        if (!alive) return
        setStats(data.stats)
        setRecentOrders(data.recentOrders ?? [])
      } finally {
        if (alive) setLoading(false)
      }
    }

    fetchAll()
    const timer = setInterval(fetchAll, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  if (loading) return <div className="p-8 text-gray-400">로딩 중...</div>
  if (!stats)  return null

  const pipelineTotal = stats.passedProducts + stats.pendingPipeline + stats.blockedProducts
  const passedPct  = pipelineTotal > 0 ? Math.round(stats.passedProducts  / pipelineTotal * 100) : 0
  const blockedPct = pipelineTotal > 0 ? Math.round(stats.blockedProducts / pipelineTotal * 100) : 0

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">대시보드</h1>

      {/* 주문 통계 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '오늘 주문',    value: stats.todayOrders,                     unit: '건', color: 'bg-blue-500',   link: '/orders' },
          { label: '처리 대기',   value: stats.pendingOrders,                    unit: '건', color: 'bg-yellow-500', link: '/orders' },
          { label: '총 매출',     value: stats.totalRevenue.toLocaleString(),    unit: '원', color: 'bg-green-500',  link: '/orders' },
          { label: '미답변 CS',   value: stats.openCs,                           unit: '건', color: 'bg-red-500',    link: '/cs' },
        ].map(c => (
          <Link key={c.label} href={c.link} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow">
            <div className={`w-8 h-8 rounded-lg ${c.color} mb-3`} />
            <p className="text-sm text-gray-500">{c.label}</p>
            <p className="text-3xl font-bold mt-1">
              {c.value}
              <span className="text-sm font-normal text-gray-400 ml-1">{c.unit}</span>
            </p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* 상품 파이프라인 현황 */}
        <div className="col-span-1 bg-white rounded-xl border p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">상품 파이프라인</h2>
            <Link href="/pipeline" className="text-xs text-blue-600 hover:underline">관리 →</Link>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">전체 상품</span>
              <span className="font-bold">{stats.totalProducts.toLocaleString()}개</span>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-green-600">통과</span>
                <span className="text-green-600">{stats.passedProducts} ({passedPct}%)</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${passedPct}%` }} />
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>대기 중: {stats.pendingPipeline}개</span>
              <span className="text-red-500">차단: {stats.blockedProducts}개</span>
            </div>
            {stats.pendingPipeline > 0 && (
              <Link
                href="/pipeline"
                className="block w-full text-center py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
              >
                지금 파이프라인 실행 ({stats.pendingPipeline}개 대기)
              </Link>
            )}
          </div>
        </div>

        {/* 빠른 액션 */}
        <div className="col-span-1 bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-4">빠른 액션</h2>
          <div className="space-y-2">
            {[
              { label: '스크래퍼 실행',     href: '/scraper',   desc: '상품 수집' },
              { label: '번역/지재권 처리',  href: '/pipeline',  desc: 'pending 상품' },
              { label: '상품 관리',         href: '/products',  desc: '상품 활성화·수정' },
              { label: 'CS 문의 확인',      href: '/cs',        desc: `미답변 ${stats.openCs}건` },
              { label: '상표 키워드 관리',  href: '/trademark', desc: '차단 브랜드 설정' },
            ].map(a => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-all"
              >
                <span className="text-sm font-medium">{a.label}</span>
                <span className="text-xs text-gray-400">{a.desc}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 오늘의 현황 요약 */}
        <div className="col-span-1 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-5 text-white">
          <h2 className="font-semibold mb-4 text-blue-100">오늘 현황</h2>
          <div className="space-y-3">
            <div>
              <p className="text-blue-200 text-xs">신규 주문</p>
              <p className="text-3xl font-bold">{stats.todayOrders}<span className="text-lg font-normal ml-1">건</span></p>
            </div>
            <div className="border-t border-blue-500 pt-3">
              <p className="text-blue-200 text-xs">처리 필요</p>
              <p className="text-xl font-bold">
                주문 {stats.pendingOrders}건
                {stats.openCs > 0 && <> · CS {stats.openCs}건</>}
              </p>
            </div>
            {stats.pendingPipeline > 0 && (
              <div className="bg-blue-500 rounded-lg px-3 py-2 text-xs">
                파이프라인 대기 {stats.pendingPipeline}개 상품
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 최근 주문 */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-semibold">최근 주문</h2>
          <Link href="/orders" className="text-xs text-blue-600 hover:underline">전체 보기 →</Link>
        </div>
        {recentOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">주문이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['주문번호', '고객명', '상태', '금액', '주문일시'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.order_number}</td>
                  <td className="px-4 py-3 font-medium">{o.customer_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? ''}`}>
                      {STATUS_KR[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{(o.total_krw ?? 0).toLocaleString()}원</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(o.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
