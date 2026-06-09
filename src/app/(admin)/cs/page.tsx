'use client'

import { useState, useEffect, useRef } from 'react'

interface Ticket {
  id:               string
  customer_name:    string
  customer_contact: string
  category:         string
  message:          string
  ai_response:      string | null
  admin_response:   string | null
  status:           string
  created_at:       string
  orders:           { order_number: string; status: string; tracking_number: string | null } | null
}

const CAT_LABEL: Record<string, string> = { shipping: '배송', refund: '환불', exchange: '교환', other: '기타' }
const CAT_COLOR: Record<string, string> = {
  shipping: 'bg-blue-100 text-blue-700', refund: 'bg-red-100 text-red-700',
  exchange: 'bg-yellow-100 text-yellow-700', other: 'bg-gray-100 text-gray-600',
}
const ST_COLOR: Record<string, string> = {
  open: 'text-red-500', in_progress: 'text-yellow-500', resolved: 'text-green-500',
}
const ST_LABEL: Record<string, string> = { open: '미답변', in_progress: '처리중', resolved: '완료' }

export default function CsPage() {
  const [tickets,    setTickets]    = useState<Ticket[]>([])
  const [selected,   setSelected]   = useState<Ticket | null>(null)
  const [filter,     setFilter]     = useState('all')
  const [aiLoading,  setAiLoading]  = useState(false)
  const [adminReply, setAdminReply] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [showNew,    setShowNew]    = useState(false)

  // 새 접수 폼
  const [newName,     setNewName]    = useState('')
  const [newContact,  setNewContact] = useState('')
  const [newCat,      setNewCat]     = useState('other')
  const [newMsg,      setNewMsg]     = useState('')
  const [submitting,  setSubmitting] = useState(false)

  const replyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { loadTickets() }, [filter])
  useEffect(() => { setAdminReply(selected?.admin_response ?? '') }, [selected])

  async function loadTickets() {
    const url = filter === 'all' ? '/api/cs' : `/api/cs?status=${filter}`
    const res  = await fetch(url)
    const data = await res.json()
    setTickets(data)
    if (selected) {
      const updated = data.find((t: Ticket) => t.id === selected.id)
      if (updated) setSelected(updated)
    }
  }

  async function generateAI() {
    if (!selected) return
    setAiLoading(true)
    const res = await fetch('/api/cs/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: selected.id }),
    })
    const data = await res.json()
    setSelected(prev => prev ? { ...prev, ai_response: data.reply } : prev)
    setAdminReply(data.reply)
    setAiLoading(false)
    setTimeout(() => replyRef.current?.focus(), 100)
  }

  async function saveReply() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/cs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, admin_response: adminReply, status: 'in_progress' }),
    })
    setSaving(false)
    loadTickets()
  }

  async function changeStatus(id: string, status: string) {
    await fetch('/api/cs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    loadTickets()
  }

  async function submitNew() {
    if (!newName || !newMsg) return
    setSubmitting(true)
    await fetch('/api/cs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: newName, customer_contact: newContact, category: newCat, message: newMsg }),
    })
    setNewName(''); setNewContact(''); setNewMsg(''); setNewCat('other')
    setShowNew(false); setSubmitting(false)
    loadTickets()
  }

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)
  const counts   = { open: tickets.filter(t => t.status === 'open').length, in_progress: tickets.filter(t => t.status === 'in_progress').length }

  return (
    <div className="p-8 flex gap-6 h-screen max-h-screen overflow-hidden">
      {/* ── 왼쪽 패널 ── */}
      <div className="w-80 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">CS 문의</h1>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
          >
            + 새 접수
          </button>
        </div>

        {/* 필터 */}
        <div className="flex gap-1 mb-3">
          {[
            ['all',         `전체 ${tickets.length}`],
            ['open',        `미답변 ${counts.open}`],
            ['in_progress', `처리중 ${counts.in_progress}`],
            ['resolved',    '완료'],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
                filter === v ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* 티켓 목록 */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className={`w-full text-left border rounded-xl p-3 transition-all ${
                selected?.id === t.id ? 'border-blue-500 bg-blue-50' : 'bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[t.category] ?? ''}`}>
                  {CAT_LABEL[t.category] ?? t.category}
                </span>
                <span className={`text-xs font-medium ${ST_COLOR[t.status] ?? ''}`}>
                  {ST_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <p className="text-sm font-medium">{t.customer_name}</p>
              <p className="text-xs text-gray-400 truncate">{t.message}</p>
              <p className="text-xs text-gray-300 mt-1">
                {new Date(t.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-gray-400 text-sm">문의 없음</div>
          )}
        </div>
      </div>

      {/* ── 오른쪽 상세 패널 ── */}
      {selected ? (
        <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">
          {/* 헤더 */}
          <div className="p-5 border-b flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg">{selected.customer_name}</h2>
              <p className="text-sm text-gray-400">{selected.customer_contact}</p>
            </div>
            <div className="flex gap-2">
              {selected.status !== 'resolved' && (
                <button
                  onClick={() => changeStatus(selected.id, 'resolved')}
                  className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                >
                  완료 처리
                </button>
              )}
              {selected.status === 'resolved' && (
                <button
                  onClick={() => changeStatus(selected.id, 'open')}
                  className="px-3 py-1.5 border text-sm rounded-lg hover:bg-gray-50"
                >
                  재오픈
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* 주문 정보 */}
            {selected.orders && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-600 mb-1 text-xs">연결된 주문</p>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>주문번호: <strong>{selected.orders.order_number}</strong></span>
                  <span>상태: <strong>{selected.orders.status}</strong></span>
                  {selected.orders.tracking_number && (
                    <span>송장: <strong>{selected.orders.tracking_number}</strong></span>
                  )}
                </div>
              </div>
            )}

            {/* 고객 메시지 */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">고객 문의</p>
              <div className="bg-gray-50 rounded-xl p-4 text-sm leading-relaxed">
                {selected.message}
              </div>
            </div>

            {/* AI 답변 생성 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">답변 작성</p>
                <button
                  onClick={generateAI}
                  disabled={aiLoading}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {aiLoading ? 'AI 생성 중...' : 'AI 답변 생성'}
                </button>
              </div>
              <textarea
                ref={replyRef}
                rows={6}
                value={adminReply}
                onChange={e => setAdminReply(e.target.value)}
                placeholder="직접 작성하거나 AI 생성 버튼을 누르세요"
                className="w-full border rounded-xl p-4 text-sm resize-none focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={saveReply}
                disabled={saving || !adminReply.trim()}
                className="mt-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '답변 저장'}
              </button>
            </div>

            {/* 기존 AI 답변 (참고용) */}
            {selected.ai_response && selected.ai_response !== adminReply && (
              <div>
                <p className="text-xs font-medium text-blue-600 mb-2">이전 AI 답변 (참고)</p>
                <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                  {selected.ai_response}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-xl border flex items-center justify-center text-gray-400">
          왼쪽에서 문의를 선택하세요
        </div>
      )}

      {/* ── 새 접수 모달 ── */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div className="bg-white rounded-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">새 CS 접수</h3>
            <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="고객명 *" value={newName} onChange={e => setNewName(e.target.value)} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="연락처" value={newContact} onChange={e => setNewContact(e.target.value)} />
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={newCat} onChange={e => setNewCat(e.target.value)}>
                <option value="shipping">배송 문의</option>
                <option value="refund">환불 요청</option>
                <option value="exchange">교환 요청</option>
                <option value="other">기타</option>
              </select>
              <textarea rows={4} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder="문의 내용 *" value={newMsg} onChange={e => setNewMsg(e.target.value)} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowNew(false)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
              <button onClick={submitNew} disabled={submitting || !newName || !newMsg} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {submitting ? '접수 중...' : '접수'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
