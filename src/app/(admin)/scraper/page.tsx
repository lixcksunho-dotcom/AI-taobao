'use client'

import { useState } from 'react'

export default function ScraperPage() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<object | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleScrape() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '스크래핑 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">타오바오 스크래퍼</h1>
      <div className="flex gap-3 mb-6">
        <input
          className="flex-1 border rounded-lg px-4 py-2 text-sm"
          placeholder="타오바오 상품 URL 입력"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
        <button
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
          onClick={handleScrape}
          disabled={loading || !url}
        >
          {loading ? '스크래핑 중...' : '실행'}
        </button>
      </div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {result && (
        <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}
