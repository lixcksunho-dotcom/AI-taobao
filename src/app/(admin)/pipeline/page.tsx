'use client'

import { useState, useEffect, useRef } from 'react'

interface Product {
  id:                   string
  title_cn:             string
  title_kr:             string | null
  trademark_status:     string
  trademark_blocked_by: string | null
  processed_at:         string | null
  price_krw:            number
  source:               string
}

interface Log {
  type:     string
  title?:   string
  message?: string
  matched?: string[]
  passed?:  number
  blocked?: number
  errors?:  number
}

const STATUS_STYLE: Record<string, string> = {
  pending:    'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-600 animate-pulse',
  passed:     'bg-green-100 text-green-700',
  blocked:    'bg-red-100 text-red-700',
  error:      'bg-yellow-100 text-yellow-700',
}
const STATUS_LABEL: Record<string, string> = {
  pending:    '대기',
  processing: '처리중',
  passed:     '통과',
  blocked:    '차단',
  error:      '오류',
}

export default function PipelinePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(true)
  const [statusFilter, setFilter] = useState('pending')
  const [limit,    setLimit]    = useState(50)

  const [running, setRunning]   = useState(false)
  const [logs,    setLogs]      = useState<Log[]>([])
  const [summary, setSummary]   = useState<Log | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadProducts() }, [statusFilter])

  async function loadProducts() {
    setLoading(true)
    const params = new URLSearchParams({ status: statusFilter, limit: '100' })
    const res  = await fetch(`/api/pipeline/products?${params}`)
    const data = await res.json()
    setProducts(data.products ?? [])
    setLoading(false)
  }

  async function runBulk() {
    setRunning(true); setLogs([]); setSummary(null)
    const res = await fetch('/api/products/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bulk', limit }),
    })
    if (!res.body) { setRunning(false); return }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt: Log = JSON.parse(line.slice(6))
          if (evt.type === 'summary') setSummary(evt)
          else setLogs(prev => [...prev, evt])
          setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 30)
        } catch { /* skip */ }
      }
    }
    setRunning(false)
    loadProducts()
  }

  async function processOne(id: string) {
    await fetch('/api/products/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'single', productId: id }),
    })
    loadProducts()
  }

  const counts = products.reduce((acc, p) => {
    acc[p.trademark_status] = (acc[p.trademark_status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">번역 / 지재권 파이프라인</h1>

      {/* 상태별 통계 */}
      <div className="flex gap-3 mb-6">
        {['pending', 'passed', 'blocked', 'error'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
              statusFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50'
            }`}
          >
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[s]}`}>
              {STATUS_LABEL[s]}
            </span>
            <span className="font-bold">{counts[s] ?? '—'}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ── 실행 패널 ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-1">수동 실행</h2>
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 mb-4">
              <p className="font-semibold mb-1">자동 실행 설정됨</p>
              <p>서버 기동 후 pending 상품 즉시 처리</p>
              <p>이후 매시간 정각 자동 실행</p>
              <p className="mt-1 text-blue-500">지금 바로 실행하려면 아래 버튼 사용</p>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              ① CN 지재권 체크 → ② 번역 → ③ KR 지재권 체크
            </p>
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">처리 개수</span>
                <span className="font-bold text-blue-600">{limit}개</span>
              </div>
              <input
                type="range" min={5} max={200} value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
            <button
              onClick={runBulk}
              disabled={running}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? '처리 중...' : '실행'}
            </button>

            {(running || logs.length > 0) && (
              <div
                ref={logRef}
                className="mt-4 h-56 overflow-y-auto bg-gray-900 rounded-lg p-3 text-xs font-mono space-y-0.5"
              >
                {logs.map((log, i) => (
                  <div key={i} className={
                    log.type === 'blocked' ? 'text-red-400' :
                    log.type === 'error'   ? 'text-yellow-400' :
                    log.type === 'done'    ? 'text-green-400' : 'text-gray-300'
                  }>
                    {log.type === 'start'     && `▶ ${log.title?.slice(0, 22) ?? log.message}`}
                    {log.type === 'check_cn'  && `① CN: ${log.title?.slice(0, 20)}`}
                    {log.type === 'translate' && `② 번역: ${log.title?.slice(0, 20)}`}
                    {log.type === 'check_kr'  && `③ KR: ${log.title?.slice(0, 20)}`}
                    {log.type === 'done'      && `✓ ${log.title?.slice(0, 25)}`}
                    {log.type === 'blocked'   && `✗ 차단[${log.matched?.join(',')}]`}
                    {log.type === 'error'     && `⚠ ${log.message}`}
                  </div>
                ))}
                {running && <div className="text-gray-500 animate-pulse">■ 실행 중...</div>}
              </div>
            )}

            {summary && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-green-700">완료</p>
                <p className="text-green-600 text-xs">
                  통과 <strong>{summary.passed}</strong> ·
                  차단 <strong className="text-red-600">{summary.blocked}</strong> ·
                  오류 {summary.errors}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── 상품 목록 ── */}
        <div className="col-span-2 bg-white rounded-xl border">
          <div className="p-4 border-b flex justify-between items-center">
            <span className="text-sm font-medium">
              {STATUS_LABEL[statusFilter]} 상품 {products.length}개
            </span>
            <button
              onClick={loadProducts}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              새로고침
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">로딩 중...</div>
          ) : (
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">원제목 (CN)</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">번역 제목 (KR)</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] truncate">
                        {p.title_cn}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[200px]">
                        {p.title_kr ? (
                          <span className="text-gray-800">{p.title_kr}</span>
                        ) : (
                          <span className="text-gray-300">미번역</span>
                        )}
                        {p.trademark_blocked_by && (
                          <div className="text-red-400 text-xs mt-0.5">
                            차단: {p.trademark_blocked_by}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[p.trademark_status] ?? ''}`}>
                          {STATUS_LABEL[p.trademark_status] ?? p.trademark_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(p.trademark_status === 'pending' || p.trademark_status === 'error') && (
                          <button
                            onClick={() => processOne(p.id)}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            처리
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                        {statusFilter === 'pending' ? '처리 대기 상품 없음' : '상품 없음'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
