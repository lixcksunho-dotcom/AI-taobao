'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
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

  const load = useCallback(async () => {
    const supabase = createClient()
    let q = supabase.from('products').select('*').order('scraped_at', { ascending: false })
    if (statusFilter) q = q.eq('stock_status', statusFilter)
    const { data } = await q
    setProducts(data ?? [])
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

  return (
    <div className="p-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">상품 관리</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">총 {products.length}개</span>
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
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  {/* 이미지 */}
                  <td className="px-4 py-3">
                    {p.images?.[0] ? (
                      <img
                        src={`/api/img?url=${encodeURIComponent(p.images[0])}`}
                        alt=""
                        className="w-14 h-14 object-cover rounded-lg"
                        onError={e => { (e.target as HTMLImageElement).src = p.images[0] }}
                      />
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
    </div>
  )
}
