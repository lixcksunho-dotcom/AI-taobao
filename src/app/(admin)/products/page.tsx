'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Product {
  id: string
  taobao_id: string
  taobao_url: string
  title_cn: string
  title_kr: string
  price_cny: number
  price_krw: number
  images: string[]
  options: { type: string; values: string[] }[]
  stock_status: string
  scraped_at: string
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  available:    { label: '판매중',  color: 'bg-green-100 text-green-700' },
  inactive:     { label: '비활성', color: 'bg-gray-100 text-gray-500' },
  out_of_stock: { label: '품절',   color: 'bg-red-100 text-red-700' },
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [gallery, setGallery] = useState<{ id: string; title: string; images: string[] } | null>(null)
  const [copied, setCopied] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  // 상세페이지 HTML(번역 상세컷 포함)을 클립보드로 복사
  async function copyDetailHtml(id: string) {
    try {
      const res = await fetch(`/api/products/detail-html?id=${id}&format=json`)
      const { html } = await res.json()
      await navigator.clipboard.writeText(html)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패')
    }
  }

  const load = useCallback(async () => {
    // RLS 우회를 위해 서버 API(service 키)로 조회
    const params = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
    const res = await fetch(`/api/products${params}`)
    const data = await res.json()
    setProducts(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function patch(id: string, updates: Partial<Product>) {
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    load()
  }

  async function toggleStatus(p: Product) {
    await patch(p.id, { stock_status: p.stock_status === 'available' ? 'inactive' : 'available' })
  }

  async function savePrice(id: string) {
    const price = parseInt(editPrice.replace(/,/g, ''), 10)
    if (!price) return
    await patch(id, { price_krw: price })
    setEditingId(null)
  }

  async function remove(id: string) {
    if (!confirm('상품을 삭제하시겠습니까?')) return
    await fetch('/api/products', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  const filtered = products.filter(p =>
    !search ||
    p.title_kr?.toLowerCase().includes(search.toLowerCase()) ||
    p.title_cn?.includes(search)
  )

  // 검색·필터·데이터 변동 시 현재 페이지가 범위를 벗어나면 보정
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => { setPage(1) }, [search, statusFilter])
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div className="p-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">상품 관리</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">총 {products.length}개</span>
          {/* CSV 내보내기 드롭다운 */}
          <div className="relative group">
            <button className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
              내보내기 ▾
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white border rounded-xl shadow-lg py-1 w-44 hidden group-hover:block z-10">
              {[
                ['general',    '기본 CSV'],
                ['smartstore', '스마트스토어'],
                ['coupang',    '쿠팡'],
              ].map(([f, l]) => (
                <a
                  key={f}
                  href={`/api/products/export?format=${f}&status=passed`}
                  className="block px-4 py-2 text-sm hover:bg-gray-50"
                >
                  {l}
                </a>
              ))}
            </div>
          </div>
          <Link
            href="/scraper"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            + 상품 추가
          </Link>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <input
          className="border rounded-lg px-4 py-2 text-sm w-60"
          placeholder="상품명 검색 (한/중)"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {([['', '전체'], ['available', '판매중'], ['inactive', '비활성'], ['out_of_stock', '품절']] as [string, string][]).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                statusFilter === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <p className="text-gray-400 py-12 text-center">로딩 중...</p>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                {['이미지', '상품명', '원가(CNY)', '판매가(KRW)', '옵션', '상태', '수집일', '관리'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  {/* 이미지 */}
                  <td className="px-4 py-3">
                    {p.images?.[0] ? (
                      <button
                        type="button"
                        onClick={() => setGallery({ id: p.id, title: p.title_kr || p.title_cn, images: p.images })}
                        className="relative block"
                        title="상세컷(번역본) 보기"
                      >
                        <img
                          src={p.images[0]}
                          alt=""
                          className="w-14 h-14 object-cover rounded-lg hover:ring-2 hover:ring-blue-400"
                          onError={e => { (e.target as HTMLImageElement).src = `/api/img?url=${encodeURIComponent(p.images[0])}` }}
                        />
                        {p.images.length > 1 && (
                          <span className="absolute -bottom-1 -right-1 bg-blue-600 text-white text-[10px] px-1 rounded-full">{p.images.length}</span>
                        )}
                      </button>
                    ) : (
                      <div className="w-14 h-14 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-xs">없음</div>
                    )}
                  </td>

                  {/* 상품명 */}
                  <td className="px-4 py-3 max-w-xs">
                    <a
                      href={p.taobao_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-gray-900 hover:text-blue-600 line-clamp-2"
                    >
                      {p.title_kr || p.title_cn}
                    </a>
                    {p.title_kr && p.title_cn && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{p.title_cn}</p>
                    )}
                  </td>

                  {/* 원가 */}
                  <td className="px-4 py-3 text-gray-600">¥{p.price_cny?.toFixed(2)}</td>

                  {/* 판매가 (클릭 편집) */}
                  <td className="px-4 py-3">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          className="border rounded px-2 py-1 w-28 text-sm focus:outline-none focus:border-blue-400"
                          value={editPrice}
                          onChange={e => setEditPrice(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') savePrice(p.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          autoFocus
                        />
                        <button onClick={() => savePrice(p.id)} className="text-xs text-blue-600 hover:text-blue-800">저장</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(p.id); setEditPrice(String(p.price_krw ?? '')) }}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                        title="클릭하여 편집"
                      >
                        {p.price_krw ? p.price_krw.toLocaleString() + '원' : '-'}
                      </button>
                    )}
                  </td>

                  {/* 옵션 */}
                  <td className="px-4 py-3">
                    {p.options?.length > 0 ? (
                      <span className="text-xs text-gray-500">{p.options.map(o => o.type).join(', ')}</span>
                    ) : (
                      <span className="text-xs text-gray-300">없음</span>
                    )}
                  </td>

                  {/* 상태 */}
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_MAP[p.stock_status]?.color ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_MAP[p.stock_status]?.label ?? p.stock_status}
                    </span>
                  </td>

                  {/* 수집일 */}
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {p.scraped_at?.slice(0, 10)}
                  </td>

                  {/* 관리 */}
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => toggleStatus(p)}
                        className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50 transition-colors"
                      >
                        {p.stock_status === 'available' ? '비활성' : '활성화'}
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="text-xs px-2.5 py-1 text-red-500 border border-red-200 rounded hover:bg-red-50 transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 페이지네이션 */}
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm">
              <span className="text-gray-500">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} / {filtered.length}개
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  이전
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`px-3 py-1 rounded border ${
                      n === currentPage ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-100'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  다음
                </button>
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="py-16 text-center">
              {products.length === 0 ? (
                <>
                  <p className="text-gray-400 mb-3">아직 스크래핑된 상품이 없습니다.</p>
                  <Link href="/scraper" className="text-sm text-blue-600 hover:underline">
                    스크래퍼에서 타오바오 URL을 입력해 상품을 추가하세요 →
                  </Link>
                </>
              ) : (
                <p className="text-gray-400">검색 결과가 없습니다.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 상세컷(번역본) 갤러리 라이트박스 */}
      {gallery && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex flex-col"
          onClick={() => setGallery(null)}
        >
          <div className="flex items-center justify-between px-6 py-4 text-white shrink-0" onClick={e => e.stopPropagation()}>
            <span className="font-medium truncate">{gallery.title} · 상세컷 {gallery.images.length}장 (번역본)</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyDetailHtml(gallery.id)}
                className="text-sm px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
              >
                {copied ? '복사됨 ✓' : '상세 HTML 복사'}
              </button>
              <a
                href={`/api/products/detail-html?id=${gallery.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
              >
                미리보기
              </a>
              <button onClick={() => setGallery(null)} className="text-2xl leading-none px-2">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-8" onClick={e => e.stopPropagation()}>
            <div className="max-w-2xl mx-auto space-y-2">
              {gallery.images.map((src, i) => (
                <img key={i} src={src} alt={`detail ${i}`} className="w-full rounded-lg bg-white" loading="lazy" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
