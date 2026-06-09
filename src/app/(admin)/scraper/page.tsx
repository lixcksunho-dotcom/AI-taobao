'use client'

import { useState, useRef } from 'react'

const CATEGORY_PRESETS = [
  { label: '여성의류',    keyword: '女装 连衣裙 上衣' },
  { label: '남성의류',    keyword: '男装 T恤 衬衫' },
  { label: '신발',        keyword: '运动鞋 小白鞋' },
  { label: '가방/지갑',   keyword: '女包 手提包 钱包' },
  { label: '뷰티/화장품', keyword: '护肤品 化妆品 面膜' },
  { label: '가전',        keyword: '小家电 蓝牙耳机 手机配件' },
  { label: '생활잡화',    keyword: '生活用品 家居收纳' },
  { label: '스포츠',      keyword: '运动服 瑜伽服 健身' },
  { label: '반려동물',    keyword: '宠物用品 猫粮 狗粮' },
  { label: '아동',        keyword: '童装 儿童玩具' },
]

interface ProgressEvent {
  type: string
  page?: number
  pages?: number
  count?: number
  saved?: number
  message?: string
  totalSaved?: number
  keyword?: string
}

type Tab = 'terminal' | 'web' | 'single'

export default function ScraperPage() {
  const [tab, setTab] = useState<Tab>('terminal')

  // 터미널 모드
  const [tmKeyword, setTmKeyword]   = useState('')
  const [tmPages,   setTmPages]     = useState(10)
  const [tmSource,  setTmSource]    = useState<'1688' | 'taobao'>('1688')
  const [tmCategory, setTmCategory] = useState('')
  const [copied, setCopied]         = useState(false)

  // 단일 URL
  const [url, setUrl]               = useState('')
  const [singleResult, setSingle]   = useState<object | null>(null)
  const [singleLoading, setSingleLoading] = useState(false)
  const [singleError, setSingleError]     = useState('')

  // 웹 대량 수집 (봇 감지 시 실패 가능)
  const [keyword, setKeyword]   = useState('')
  const [category, setCategory] = useState('')
  const [pages, setPages]       = useState(5)
  const [source, setSource]     = useState<'auto' | 'taobao' | '1688'>('1688')
  const [running, setRunning]   = useState(false)
  const [logs, setLogs]         = useState<ProgressEvent[]>([])
  const [done, setDone]         = useState<ProgressEvent | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  function addLog(evt: ProgressEvent) {
    setLogs(prev => [...prev, evt])
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50)
  }

  // 터미널 명령어 생성
  const kw = tmKeyword.trim() || (CATEGORY_PRESETS.find(p => p.label === tmCategory)?.keyword ?? '连衣裙')
  const terminalCmd = `node scripts/scrape-interactive.mjs "${kw}" ${tmPages} ${tmSource}`

  async function handleCopy() {
    await navigator.clipboard.writeText(terminalCmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 단일 스크래핑
  async function handleSingle() {
    setSingleLoading(true); setSingleError(''); setSingle(null)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSingle(data)
    } catch (e: unknown) {
      setSingleError(e instanceof Error ? e.message : '실패')
    } finally {
      setSingleLoading(false)
    }
  }

  // 웹 대량 수집
  async function handleBulk() {
    if (!keyword.trim()) return
    setRunning(true); setLogs([]); setDone(null)
    try {
      const res = await fetch('/api/scrape/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, pages, category, source }),
      })
      if (!res.body) throw new Error('스트림 없음')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt: ProgressEvent = JSON.parse(line.slice(6))
            if (evt.type === 'done') setDone(evt)
            else addLog(evt)
          } catch { /* skip */ }
        }
      }
    } catch (e: unknown) {
      addLog({ type: 'error', message: e instanceof Error ? e.message : '연결 오류' })
    } finally {
      setRunning(false)
    }
  }

  const progress    = logs.filter(l => l.type === 'page_done').length
  const progressPct = pages > 0 ? Math.round((progress / pages) * 100) : 0

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">타오바오 스크래퍼</h1>

      {/* 알리바바 봇 감지 경고 */}
      <div className="mb-6 bg-amber-50 border border-amber-300 rounded-xl p-4">
        <p className="font-semibold text-amber-800 mb-1">알리바바 天马盾(tmd) 봇 감지 안내</p>
        <p className="text-sm text-amber-700">
          타오바오·1688 모두 CDN 레벨 봇 차단 시스템을 사용합니다.
          <strong> 터미널 스크래핑 모드</strong>를 이용하면 브라우저 창이 열리고,
          캡차가 뜰 경우 직접 한 번만 풀면 이후 자동으로 수집됩니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-8 border-b">
        {([
          ['terminal', '터미널 스크래핑 (권장)'],
          ['web',      '웹 대량 수집 (봇 감지 있음)'],
          ['single',   '단일 URL'],
        ] as [Tab, string][]).map(([t, l]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ──────────────────────────────
          터미널 스크래핑 탭 (권장)
          ────────────────────────────── */}
      {tab === 'terminal' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
            <p className="font-semibold mb-1">동작 방식</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>아래 명령어를 복사하여 프로젝트 폴더 터미널에서 실행</li>
              <li>Chrome 창이 열림 — 캡차가 뜨면 직접 해결</li>
              <li>캡차 해결 후 자동으로 전체 페이지 수집 → Supabase DB 저장</li>
              <li>완료 후 <a href="/products" className="underline">상품 관리</a>에서 확인</li>
            </ol>
          </div>

          {/* 카테고리 프리셋 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">카테고리 빠른 선택</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setTmKeyword(p.keyword); setTmCategory(p.label) }}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    tmCategory === p.label
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 키워드 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">검색 키워드</label>
            <input
              className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400"
              placeholder="예: 女装 连衣裙 (카테고리 선택 시 자동 입력)"
              value={tmKeyword}
              onChange={e => setTmKeyword(e.target.value)}
            />
          </div>

          {/* 소스 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">수집 소스</p>
            <div className="flex gap-2">
              {([
                ['1688',   '1688.com (권장)', '도매가, 봇 감지 약함'],
                ['taobao', '타오바오',         '소매가, 봇 감지 강함'],
              ] as ['1688' | 'taobao', string, string][]).map(([v, l, d]) => (
                <button
                  key={v} title={d} onClick={() => setTmSource(v)}
                  className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                    tmSource === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 페이지 슬라이더 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">수집 페이지 수</label>
              <span className="text-sm font-bold text-blue-600">
                {tmPages}페이지 (최대 약 {tmPages * 44}개)
              </span>
            </div>
            <input
              type="range" min={1} max={20} value={tmPages}
              onChange={e => setTmPages(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>1p (~44개)</span><span>10p (~440개)</span><span>20p (~880개)</span>
            </div>
          </div>

          {/* 생성된 명령어 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">터미널 명령어</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 bg-gray-900 text-green-400 rounded-lg px-4 py-3 text-sm font-mono overflow-x-auto">
                {terminalCmd}
              </code>
              <button
                onClick={handleCopy}
                className={`px-4 py-3 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
                  copied ? 'bg-green-600 text-white border-green-600' : 'bg-white hover:bg-gray-50'
                }`}
              >
                {copied ? '복사됨 ✓' : '복사'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              * Claude Code CLI에서 직접 실행하려면 앞에 <code className="bg-gray-100 px-1 rounded">! </code> 를 붙이세요
            </p>
          </div>

          {/* 실행 안내 */}
          <div className="bg-gray-50 border rounded-xl p-4 text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-700">실행 전 확인사항</p>
            <p>• 프로젝트 루트 폴더에서 실행: <code className="bg-white border rounded px-1">cd C:\Users\LH\Desktop\중요\taobao-auto-platform</code></p>
            <p>• <code className="bg-white border rounded px-1">.env.local</code> 에 Supabase 키가 설정되어 있어야 합니다</p>
            <p>• 캡차 해결 후 자동 수집 — 3분 이상 캡차를 풀지 않으면 다음 페이지로 넘어갑니다</p>
            <p>• 수집 완료 시 터미널에 저장 개수가 출력됩니다</p>
          </div>
        </div>
      )}

      {/* ──────────────────────────────
          웹 대량 수집 탭
          ────────────────────────────── */}
      {tab === 'web' && (
        <div className="space-y-6">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-700">
            <p className="font-semibold mb-1">⚠ 봇 감지 경고</p>
            <p>웹 서버에서 실행되는 headless 브라우저는 알리바바의 봇 감지에 막힐 수 있습니다.
            캡차가 뜨면 0개가 수집됩니다. 권장: <button className="underline" onClick={() => setTab('terminal')}>터미널 스크래핑 탭</button> 사용</p>
          </div>

          {/* 카테고리 프리셋 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">카테고리 빠른 선택</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setKeyword(p.keyword); setCategory(p.label) }}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    category === p.label
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              검색 키워드
            </label>
            <input
              className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400"
              placeholder="예: 女装 连衣裙"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !running && handleBulk()}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">카테고리 이름</label>
            <input
              className="w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400"
              placeholder="예: 여성의류"
              value={category}
              onChange={e => setCategory(e.target.value)}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">수집 소스</p>
            <div className="flex gap-2">
              {([
                ['1688',   '1688.com (권장)'],
                ['auto',   '자동'],
                ['taobao', '타오바오'],
              ] as [typeof source, string][]).map(([v, l]) => (
                <button
                  key={v} onClick={() => setSource(v)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    source === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">수집 페이지 수</label>
              <span className="text-sm font-bold text-blue-600">{pages}페이지 (~{pages * 44}개)</span>
            </div>
            <input
              type="range" min={1} max={20} value={pages}
              onChange={e => setPages(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <button
            onClick={handleBulk}
            disabled={running || !keyword.trim()}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? '수집 중...' : `수집 시작 (${pages}페이지)`}
          </button>

          {(running || logs.length > 0) && (
            <div className="bg-gray-900 rounded-xl p-4">
              {running && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>진행</span><span>{progress} / {pages} 페이지</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
              <div ref={logRef} className="h-48 overflow-y-auto text-xs font-mono space-y-0.5">
                {logs.map((log, i) => (
                  <div key={i} className={
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'warn'  ? 'text-yellow-400' :
                    log.type === 'page_done' ? 'text-green-400' : 'text-gray-300'
                  }>
                    {log.type === 'start'     && `▶ 수집 시작: "${log.message ?? keyword}"`}
                    {log.type === 'progress'  && `⏳ 페이지 ${log.page}/${log.pages} 수집 중...`}
                    {log.type === 'page_done' && `✓ ${log.page}/${log.pages}p — ${log.count}개, 저장 ${log.saved}개`}
                    {log.type === 'warn'      && `⚠ ${log.message}`}
                    {log.type === 'error'     && `✗ 페이지 ${log.page}: ${log.message}`}
                  </div>
                ))}
                {running && <div className="text-gray-500 animate-pulse">■ 실행 중...</div>}
              </div>
            </div>
          )}

          {done && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <p className="text-green-700 font-bold text-lg mb-1">수집 완료</p>
              <p className="text-green-600 text-sm">
                "{done.keyword}" — 총 <strong>{done.totalSaved}개</strong> DB 저장
              </p>
              <a href="/products" className="inline-block mt-3 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                상품 관리에서 확인 →
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── 단일 URL 탭 ── */}
      {tab === 'single' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              className="flex-1 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400"
              placeholder="https://item.taobao.com/item.htm?id=..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !singleLoading && handleSingle()}
            />
            <button
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-blue-700"
              onClick={handleSingle}
              disabled={singleLoading || !url.trim()}
            >
              {singleLoading ? '스크래핑 중...' : '실행'}
            </button>
          </div>
          {singleError && <p className="text-red-500 text-sm">{singleError}</p>}
          {singleResult && (
            <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-96">
              {JSON.stringify(singleResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
