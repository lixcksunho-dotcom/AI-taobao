'use client'

import { useState, useEffect, useRef } from 'react'

interface Block {
  id:          string
  keyword:     string
  lang:        string
  category:    string
  note:        string | null
  block_count: number
}

interface PipelineLog {
  type:     string
  title?:   string
  message?: string
  matched?: string[]
  passed?:  number
  blocked?: number
  errors?:  number
}

const LANG_LABEL: Record<string, string>     = { all: '전체', cn: '중국어', kr: '한국어', en: '영어' }
const CAT_LABEL: Record<string, string>      = { brand: '브랜드', generic: '일반표현', custom: '커스텀' }
const CAT_COLOR: Record<string, string>      = {
  brand:   'bg-red-100 text-red-700',
  generic: 'bg-orange-100 text-orange-700',
  custom:  'bg-blue-100 text-blue-700',
}

export default function TrademarkPage() {
  const [blocks,  setBlocks]  = useState<Block[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [catFilter, setCat]   = useState('all')

  // 추가 폼
  const [newKeyword, setNewKeyword] = useState('')
  const [newLang,    setNewLang]    = useState('all')
  const [newCat,     setNewCat]     = useState('brand')
  const [newNote,    setNewNote]    = useState('')
  const [adding,     setAdding]     = useState(false)

  // 파이프라인
  const [pipeLimit,   setPipeLimit]   = useState(50)
  const [pipeRunning, setPipeRunning] = useState(false)
  const [pipeLogs,    setPipeLogs]    = useState<PipelineLog[]>([])
  const [pipeSummary, setPipeSummary] = useState<PipelineLog | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadBlocks() }, [])

  async function loadBlocks() {
    setLoading(true)
    const res  = await fetch('/api/trademark')
    const data = await res.json()
    setBlocks(data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!newKeyword.trim()) return
    setAdding(true)
    await fetch('/api/trademark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: newKeyword, lang: newLang, category: newCat, note: newNote }),
    })
    setNewKeyword(''); setNewNote('')
    await loadBlocks()
    setAdding(false)
  }

  async function handleDelete(id: string) {
    await fetch('/api/trademark', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBlocks(prev => prev.filter(b => b.id !== id))
  }

  async function runPipeline() {
    setPipeRunning(true); setPipeLogs([]); setPipeSummary(null)
    const res = await fetch('/api/products/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bulk', limit: pipeLimit }),
    })
    if (!res.body) { setPipeRunning(false); return }

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
          const evt: PipelineLog = JSON.parse(line.slice(6))
          if (evt.type === 'summary') setPipeSummary(evt)
          else setPipeLogs(prev => [...prev, evt])
          setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 30)
        } catch { /* skip */ }
      }
    }
    setPipeRunning(false)
    loadBlocks()
  }

  const filtered = blocks.filter(b => {
    const matchSearch = !search || b.keyword.toLowerCase().includes(search.toLowerCase())
    const matchCat    = catFilter === 'all' || b.category === catFilter
    return matchSearch && matchCat
  })

  const stats = {
    total:   blocks.length,
    brand:   blocks.filter(b => b.category === 'brand').length,
    generic: blocks.filter(b => b.category === 'generic').length,
    blocked: blocks.reduce((s, b) => s + b.block_count, 0),
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">지재권 / 상표권 관리</h1>

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          ['차단 키워드', stats.total, 'text-gray-800'],
          ['브랜드',      stats.brand,   'text-red-600'],
          ['일반 표현',   stats.generic, 'text-orange-600'],
          ['누적 차단',   stats.blocked, 'text-purple-600'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="bg-white rounded-xl p-4 border">
            <p className="text-sm text-gray-500">{l}</p>
            <p className={`text-2xl font-bold ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ── 왼쪽: 파이프라인 실행 ── */}
        <div className="col-span-1 space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-4">파이프라인 실행</h2>
            <p className="text-xs text-gray-500 mb-3">
              pending 상품을 한꺼번에 처리합니다.<br />
              중국어 체크 → 번역 → 한국어 체크 → 완료
            </p>
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600">처리 개수</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range" min={5} max={200} value={pipeLimit}
                  onChange={e => setPipeLimit(Number(e.target.value))}
                  className="flex-1 accent-blue-600"
                />
                <span className="text-sm font-bold text-blue-600 w-10 text-right">{pipeLimit}</span>
              </div>
            </div>
            <button
              onClick={runPipeline}
              disabled={pipeRunning}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {pipeRunning ? '처리 중...' : '지금 실행'}
            </button>

            {/* 로그 */}
            {(pipeRunning || pipeLogs.length > 0) && (
              <div
                ref={logRef}
                className="mt-4 h-64 overflow-y-auto bg-gray-900 rounded-lg p-3 text-xs font-mono space-y-0.5"
              >
                {pipeLogs.map((log, i) => (
                  <div key={i} className={
                    log.type === 'blocked' ? 'text-red-400' :
                    log.type === 'error'   ? 'text-yellow-400' :
                    log.type === 'done'    ? 'text-green-400' :
                    'text-gray-300'
                  }>
                    {log.type === 'start'     && `▶ 시작: ${log.title ?? log.message}`}
                    {log.type === 'check_cn'  && `① CN 체크: ${log.title?.slice(0, 20)}`}
                    {log.type === 'translate' && `② 번역: ${log.title?.slice(0, 20)}`}
                    {log.type === 'check_kr'  && `③ KR 체크: ${log.title?.slice(0, 20)}`}
                    {log.type === 'done'      && `✓ 완료: ${log.title?.slice(0, 20)}`}
                    {log.type === 'blocked'   && `✗ 차단: [${log.matched?.join(', ')}]`}
                    {log.type === 'error'     && `⚠ ${log.message}`}
                  </div>
                ))}
                {pipeRunning && <div className="text-gray-500 animate-pulse">■ 처리 중...</div>}
              </div>
            )}

            {pipeSummary && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-green-700">처리 완료</p>
                <p className="text-green-600">
                  통과 {pipeSummary.passed} · 차단 {pipeSummary.blocked} · 오류 {pipeSummary.errors}
                </p>
              </div>
            )}
          </div>

          {/* 키워드 추가 */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-4">키워드 추가</h2>
            <div className="space-y-3">
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                placeholder="차단 키워드"
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 border rounded-lg px-2 py-2 text-xs"
                  value={newLang}
                  onChange={e => setNewLang(e.target.value)}
                >
                  {Object.entries(LANG_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <select
                  className="flex-1 border rounded-lg px-2 py-2 text-xs"
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                >
                  {Object.entries(CAT_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                placeholder="메모 (선택)"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
              />
              <button
                onClick={handleAdd}
                disabled={adding || !newKeyword.trim()}
                className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50"
              >
                {adding ? '추가 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>

        {/* ── 오른쪽: 키워드 목록 ── */}
        <div className="col-span-2 bg-white rounded-xl border">
          <div className="p-4 border-b flex gap-3">
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              placeholder="키워드 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex gap-1">
              {['all', 'brand', 'generic', 'custom'].map(c => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`px-3 py-2 rounded-lg text-xs transition-colors ${
                    catFilter === c ? 'bg-gray-900 text-white' : 'border hover:bg-gray-50'
                  }`}
                >
                  {c === 'all' ? '전체' : CAT_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">로딩 중...</div>
          ) : (
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">키워드</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">언어</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">분류</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">차단 수</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">메모</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(b => (
                    <tr key={b.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono font-medium">{b.keyword}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{LANG_LABEL[b.lang] ?? b.lang}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[b.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {CAT_LABEL[b.category] ?? b.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">{b.block_count}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{b.note ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleDelete(b.id)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        {search ? '검색 결과 없음' : '등록된 키워드 없음'}
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
