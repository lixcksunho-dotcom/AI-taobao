'use client'

import { useEffect, useState, useCallback } from 'react'

interface Order {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string
  customer_email: string
  shipping_address: string
  items: unknown
  total_krw: number
  status: string
  tracking_number: string
  tracking_carrier: string
  paid_at: string
  shipped_at: string
  created_at: string
}

const STATUS_FLOW: [string, string, string][] = [
  ['pending',   '결제대기', 'bg-yellow-100 text-yellow-700'],
  ['paid',      '결제완료', 'bg-blue-100 text-blue-700'],
  ['ordering',  '주문중',   'bg-purple-100 text-purple-700'],
  ['shipping',  '배송중',   'bg-indigo-100 text-indigo-700'],
  ['delivered', '도착',     'bg-teal-100 text-teal-700'],
  ['done',      '완료',     'bg-green-100 text-green-700'],
]
const STATUS_MAP = Object.fromEntries(STATUS_FLOW.map(([k, l, c]) => [k, { label: l, color: c }]))

const NOTIFY_TYPES: { type: string; label: string; statuses: string[] }[] = [
  { type: 'order_confirm', label: '주문확인 알림', statuses: ['paid'] },
  { type: 'shipping_start', label: '배송시작 알림', statuses: ['shipping'] },
  { type: 'arrival',       label: '도착 알림',    statuses: ['delivered', 'done'] },
]

const EMPTY_FORM = {
  customer_name: '', customer_phone: '', customer_email: '',
  shipping_address: '', items_text: '', total_krw: '',
}

export default function OrdersPage() {
  const [orders, setOrders]           = useState<Order[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected]       = useState<Order | null>(null)
  const [showNew, setShowNew]         = useState(false)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [tracking, setTracking]       = useState({ number: '', carrier: '' })
  const [submitting, setSubmitting]   = useState(false)
  const [notifyMsg, setNotifyMsg]     = useState('')

  const load = useCallback(async () => {
    // RLS 우회: 서버 API(service 키)로 조회
    const params = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
    const res = await fetch(`/api/orders${params}`)
    const data: Order[] = res.ok ? await res.json() : []
    setOrders(Array.isArray(data) ? data : [])
    if (selected) {
      const refreshed = (Array.isArray(data) ? data : []).find(o => o.id === selected.id)
      if (refreshed) setSelected(refreshed)
    }
  }, [statusFilter, selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function changeStatus(orderId: string, status: string) {
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, status }),
    })
    load()
  }

  async function saveTracking(orderId: string) {
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, tracking_number: tracking.number, tracking_carrier: tracking.carrier }),
    })
    load()
  }

  async function sendNotify(orderId: string, type: string) {
    setNotifyMsg('')
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, type, channel: 'kakao' }),
    })
    const data = await res.json()
    setNotifyMsg(data.success ? '알림 발송 완료' : '발송 실패 (로그 확인)')
  }

  async function createOrder() {
    setSubmitting(true)
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        shipping_address: form.shipping_address,
        items: form.items_text ? [{ description: form.items_text }] : [],
        total_krw: parseInt(form.total_krw.replace(/,/g, ''), 10) || 0,
        status: 'pending',
      }),
    })
    setForm(EMPTY_FORM)
    setShowNew(false)
    setSubmitting(false)
    load()
  }

  const statusIdx = (s: string) => STATUS_FLOW.findIndex(([k]) => k === s)

  return (
    <div className="p-8 flex gap-6 min-h-screen">
      {/* 좌측: 목록 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">주문 관리</h1>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            + 신규 주문 등록
          </button>
        </div>

        {/* 상태 필터 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[['', '전체'], ...STATUS_FLOW.map(([k, l]) => [k, l])].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                statusFilter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                {['주문번호', '고객명', '연락처', '금액', '상태', '주문일'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map(o => (
                <tr
                  key={o.id}
                  onClick={() => { setSelected(o); setTracking({ number: o.tracking_number ?? '', carrier: o.tracking_carrier ?? '' }); setNotifyMsg('') }}
                  className={`cursor-pointer transition-colors ${selected?.id === o.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3 font-mono text-xs">{o.order_number}</td>
                  <td className="px-4 py-3 font-medium">{o.customer_name}</td>
                  <td className="px-4 py-3 text-gray-500">{o.customer_phone}</td>
                  <td className="px-4 py-3">{o.total_krw?.toLocaleString()}원</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_MAP[o.status]?.color ?? 'bg-gray-100'}`}>
                      {STATUS_MAP[o.status]?.label ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{o.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="py-12 text-center text-gray-400">주문 없음</p>}
        </div>
      </div>

      {/* 우측: 주문 상세 패널 */}
      {selected && (
        <div className="w-96 bg-white rounded-xl shadow border p-6 flex-shrink-0 self-start sticky top-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">주문 상세</h2>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          </div>

          {/* 고객 정보 */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm space-y-1">
            <p><span className="text-gray-500 w-16 inline-block">주문번호</span><span className="font-mono text-xs">{selected.order_number}</span></p>
            <p><span className="text-gray-500 w-16 inline-block">고객명</span>{selected.customer_name}</p>
            <p><span className="text-gray-500 w-16 inline-block">연락처</span>{selected.customer_phone}</p>
            {selected.customer_email && <p><span className="text-gray-500 w-16 inline-block">이메일</span>{selected.customer_email}</p>}
            <p><span className="text-gray-500 w-16 inline-block">주소</span><span className="text-xs">{selected.shipping_address}</span></p>
            <p><span className="text-gray-500 w-16 inline-block">결제금액</span><strong>{selected.total_krw?.toLocaleString()}원</strong></p>
          </div>

          {/* 상태 변경 */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2 font-medium">상태 변경</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FLOW.map(([k, l, c]) => (
                <button
                  key={k}
                  onClick={() => changeStatus(selected.id, k)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                    selected.status === k
                      ? c + ' border-transparent'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 운송장 */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2 font-medium">운송장 정보</p>
            <div className="flex gap-2 mb-1">
              <input
                className="border rounded px-2 py-1 text-xs w-24"
                placeholder="택배사"
                value={tracking.carrier}
                onChange={e => setTracking(t => ({ ...t, carrier: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1 text-xs flex-1"
                placeholder="운송장 번호"
                value={tracking.number}
                onChange={e => setTracking(t => ({ ...t, number: e.target.value }))}
              />
              <button
                onClick={() => saveTracking(selected.id)}
                className="text-xs px-2 py-1 bg-gray-800 text-white rounded hover:bg-gray-900"
              >
                저장
              </button>
            </div>
          </div>

          {/* 알림 발송 */}
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-2 font-medium">알림 발송 (카카오)</p>
            <div className="flex flex-col gap-1.5">
              {NOTIFY_TYPES.map(n => (
                <button
                  key={n.type}
                  onClick={() => sendNotify(selected.id, n.type)}
                  disabled={!n.statuses.includes(selected.status)}
                  className="text-xs px-3 py-2 border rounded text-left hover:bg-blue-50 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {n.label}
                  <span className="text-gray-400 ml-1">({n.statuses.map(s => STATUS_MAP[s]?.label).join('/')})</span>
                </button>
              ))}
            </div>
            {notifyMsg && (
              <p className={`text-xs mt-2 ${notifyMsg.includes('완료') ? 'text-green-600' : 'text-red-500'}`}>
                {notifyMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 신규 주문 등록 모달 */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">신규 주문 등록</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              {([
                ['customer_name',    '고객명 *',   'text',  ''],
                ['customer_phone',   '연락처 *',   'tel',   '010-0000-0000'],
                ['customer_email',   '이메일',     'email', ''],
                ['shipping_address', '배송지 *',   'text',  '주소 전체 입력'],
                ['items_text',       '주문상품',   'text',  '상품명/옵션/수량'],
                ['total_krw',        '결제금액 *', 'text',  '숫자만'],
              ] as [keyof typeof form, string, string, string][]).map(([key, label, type, ph]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    placeholder={ph}
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={createOrder}
                disabled={submitting || !form.customer_name || !form.customer_phone}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
