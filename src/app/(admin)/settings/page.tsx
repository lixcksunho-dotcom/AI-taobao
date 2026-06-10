'use client'

import { useEffect, useState } from 'react'

interface EnvStatus {
  label:    string
  key:      string
  desc:     string
  set:      boolean
  required: boolean
}

interface Pricing {
  cnyToKrw:    number
  shippingFee: number
  coupangFee:  number
  marginRate:  number
}

export default function SettingsPage() {
  const [envStatuses, setEnvStatuses] = useState<EnvStatus[]>([])
  const [pricing, setPricing]         = useState<Pricing | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => { setEnvStatuses(d.env ?? []); setPricing(d.pricing ?? null) })
      .catch(() => {})
  }, [])

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

      {/* 가격 설정 (현재 적용값) */}
      <section className="mb-8 bg-white rounded-xl border p-6">
        <h2 className="font-semibold mb-1">가격 산정 설정</h2>
        <p className="text-xs text-gray-400 mb-4">
          현재 서버 <strong>.env.local</strong>에 적용된 값입니다. 변경하려면 .env.local을 수정 후
          <code className="mx-1 px-1 bg-gray-100 rounded">node scripts/calc-pricing.mjs</code>로 재계산하세요.
        </p>

        {!pricing ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
              {[
                { label: 'CNY→KRW 환율',  value: `${pricing.cnyToKrw}원` },
                { label: '배송비',        value: `${pricing.shippingFee.toLocaleString()}원` },
                { label: '쿠팡 수수료율', value: `${(pricing.coupangFee * 100).toFixed(1)}%` },
                { label: '목표 마진율',   value: `${(pricing.marginRate * 100).toFixed(0)}%` },
              ].map(c => (
                <div key={c.label} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{c.label}</p>
                  <p className="font-bold mt-0.5">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <p className="text-gray-500 text-xs mb-2">
                판매가 = (원가₩ + 배송비) ÷ (1 − 쿠팡수수료율 − 마진율), 100원 올림
              </p>
              <div className="flex gap-6">
                {[10, 20, 50, 100].map(cny => {
                  const costKrw = cny * pricing.cnyToKrw + pricing.shippingFee
                  const denom   = Math.max(0.01, 1 - pricing.coupangFee - pricing.marginRate)
                  const krw     = Math.ceil(costKrw / denom / 100) * 100
                  return (
                    <div key={cny} className="text-center">
                      <p className="text-xs text-gray-400">원가 ¥{cny}</p>
                      <p className="font-bold">₩{krw.toLocaleString()}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </section>

      {/* 환경변수 상태 */}
      <section className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold mb-4">환경변수 상태</h2>
        <p className="text-xs text-gray-400 mb-4">
          .env.local 파일에서 설정합니다.
          서버에서만 읽을 수 있어 실제 값 표시는 불가합니다.
        </p>
        <div className="space-y-3">
          {envStatuses.length === 0 && <p className="text-sm text-gray-400">불러오는 중...</p>}
          {envStatuses.map(e => {
            // 필수인데 미설정이면 빨강, 선택인데 미설정이면 회색, 설정됨이면 초록
            const dot  = e.set ? 'bg-green-500' : e.required ? 'bg-red-400' : 'bg-gray-300'
            const text = e.set ? 'text-green-600' : e.required ? 'text-red-500' : 'text-gray-400'
            const word = e.set ? '설정됨' : e.required ? '미설정(필수)' : '미설정(선택)'
            return (
              <div key={e.key} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{e.label}</p>
                  <p className="text-xs text-gray-400">{e.key}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">{e.desc}</p>
                  <span className={`text-xs ${text}`}>{word}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-5 bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">.env.local 설정 위치</p>
          <code className="text-xs text-gray-700 block">
            C:\Users\선호\AI-taobao\.env.local
          </code>
        </div>
      </section>
    </div>
  )
}
