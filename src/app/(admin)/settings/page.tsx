'use client'

import { useState } from 'react'

interface EnvStatus {
  label:   string
  key:     string
  status:  'ok' | 'missing' | 'unknown'
  desc:    string
}

export default function SettingsPage() {
  const [rate,   setRate]   = useState('190')
  const [margin, setMargin] = useState('1.3')
  const [saved,  setSaved]  = useState(false)

  // 설정 저장 (로컬스토리지에 임시 저장 — 실제로는 .env.local 수정 필요)
  function handleSave() {
    localStorage.setItem('cny_rate',    rate)
    localStorage.setItem('margin_rate', margin)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const envStatuses: EnvStatus[] = [
    { label: 'Supabase URL',          key: 'NEXT_PUBLIC_SUPABASE_URL',     status: 'ok',      desc: 'DB 연결' },
    { label: 'Supabase Service Key',  key: 'SUPABASE_SERVICE_ROLE_KEY',    status: 'ok',      desc: 'DB 쓰기 권한' },
    { label: 'Claude API Key',        key: 'ANTHROPIC_API_KEY',            status: 'unknown', desc: '번역·CS 자동응답' },
    { label: 'Aligo Key',             key: 'ALIGO_KEY',                    status: 'unknown', desc: '카카오 알림톡' },
    { label: 'AliExpress App Key',    key: 'ALIEXPRESS_APP_KEY',           status: 'missing', desc: '대안 상품 수집' },
    { label: 'Proxy Server',          key: 'PROXY_SERVER',                 status: 'missing', desc: '스크래퍼 프록시 (선택)' },
  ]

  const flowSteps = [
    { step: '1', title: '상품 수집',         desc: '스크래퍼 실행 → 1688/타오바오 상품 DB 저장',                color: 'bg-blue-500',   link: '/scraper' },
    { step: '2', title: '지재권 체크',        desc: '중국어 상표 체크 → 차단 상품 필터링',                       color: 'bg-orange-500', link: '/trademark' },
    { step: '3', title: '자동 번역',          desc: 'Claude AI → 제목·옵션·키워드 한국어 번역',                   color: 'bg-purple-500', link: '/pipeline' },
    { step: '4', title: '한국어 지재권 체크', desc: '번역된 텍스트에서 브랜드명 제거',                            color: 'bg-yellow-500', link: '/trademark' },
    { step: '5', title: '상품 관리',          desc: '번역 완료 상품 확인·수정·활성화',                            color: 'bg-green-500',  link: '/products' },
    { step: '6', title: '주문 처리',          desc: '주문 접수 → 발주 → 배송 → 완료',                            color: 'bg-teal-500',   link: '/orders' },
    { step: '7', title: 'CS 자동응답',        desc: 'Claude AI 답변 생성 → 수정 후 발송',                         color: 'bg-red-500',    link: '/cs' },
  ]

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-8">설정</h1>

      {/* 전체 플로우 */}
      <section className="mb-8">
        <h2 className="font-semibold text-gray-700 mb-4">전체 운영 플로우</h2>
        <div className="relative">
          <div className="space-y-3">
            {flowSteps.map(s => (
              <a key={s.step} href={s.link} className="flex items-center gap-4 bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow group">
                <div className={`w-9 h-9 rounded-full ${s.color} text-white flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                  {s.step}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{s.title}</p>
                  <p className="text-xs text-gray-500">{s.desc}</p>
                </div>
                <span className="text-gray-300 group-hover:text-gray-500">→</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* 환율/마진 설정 */}
      <section className="mb-8 bg-white rounded-xl border p-6">
        <h2 className="font-semibold mb-4">환율 / 마진 설정</h2>
        <p className="text-xs text-gray-400 mb-4">
          변경 후 <strong>.env.local</strong> 파일의 CNY_TO_KRW_RATE, MARGIN_RATE도 같이 수정해야 서버 재시작 시 적용됩니다.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CNY → KRW 환율
              <span className="text-gray-400 font-normal ml-1">(현재 1위안 = ?원)</span>
            </label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              value={rate}
              onChange={e => setRate(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">예: 190 (1위안 = 190원)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              마진율
              <span className="text-gray-400 font-normal ml-1">(1.3 = 30% 마진)</span>
            </label>
            <input
              type="number"
              step="0.05"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              value={margin}
              onChange={e => setMargin(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">예: 1.3 (원가 × 1.3 = 판매가)</p>
          </div>
        </div>

        {/* 가격 미리보기 */}
        <div className="bg-gray-50 rounded-lg p-3 text-sm mb-4">
          <p className="text-gray-500 text-xs mb-2">가격 계산 미리보기</p>
          <div className="flex gap-6">
            {[10, 20, 50, 100].map(cny => {
              const krw = Math.ceil(cny * parseFloat(rate || '190') * parseFloat(margin || '1.3') / 100) * 100
              return (
                <div key={cny} className="text-center">
                  <p className="text-xs text-gray-400">¥{cny}</p>
                  <p className="font-bold">₩{krw.toLocaleString()}</p>
                </div>
              )
            })}
          </div>
        </div>

        <button
          onClick={handleSave}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            saved ? 'bg-green-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'
          }`}
        >
          {saved ? '저장됨 ✓' : '저장'}
        </button>
      </section>

      {/* 환경변수 상태 */}
      <section className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold mb-4">환경변수 상태</h2>
        <p className="text-xs text-gray-400 mb-4">
          .env.local 파일에서 설정합니다.
          서버에서만 읽을 수 있어 실제 값 표시는 불가합니다.
        </p>
        <div className="space-y-3">
          {envStatuses.map(e => (
            <div key={e.key} className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                e.status === 'ok'      ? 'bg-green-500' :
                e.status === 'missing' ? 'bg-red-400'   : 'bg-yellow-400'
              }`} />
              <div className="flex-1">
                <p className="text-sm font-medium">{e.label}</p>
                <p className="text-xs text-gray-400">{e.key}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{e.desc}</p>
                <span className={`text-xs ${
                  e.status === 'ok' ? 'text-green-600' :
                  e.status === 'missing' ? 'text-red-500' : 'text-yellow-600'
                }`}>
                  {e.status === 'ok' ? '설정됨' : e.status === 'missing' ? '미설정' : '확인 필요'}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">.env.local 설정 위치</p>
          <code className="text-xs text-gray-700 block">
            C:\Users\LH\Desktop\중요\taobao-auto-platform\.env.local
          </code>
        </div>
      </section>
    </div>
  )
}
