'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function CsPage() {
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('cs_tickets').select('*, orders(order_number)').order('created_at', { ascending: false })
      .then(({ data }) => setTickets(data ?? []))
  }, [])

  const CATEGORY_LABEL: Record<string, string> = {
    shipping: '배송', refund: '환불', exchange: '교환', other: '기타',
  }

  return (
    <div className="p-8 flex gap-6">
      <div className="w-80 flex flex-col gap-2">
        <h1 className="text-2xl font-bold mb-2">CS 문의</h1>
        {tickets.map(t => (
          <button
            key={String(t.id)}
            onClick={() => setSelected(t)}
            className={`text-left border rounded-xl p-3 hover:bg-blue-50 ${selected?.id === t.id ? 'border-blue-500 bg-blue-50' : 'bg-white'}`}
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{CATEGORY_LABEL[String(t.category)]}</span>
              <span className={`text-xs ${t.status === 'open' ? 'text-red-500' : 'text-gray-400'}`}>{String(t.status)}</span>
            </div>
            <p className="text-sm font-medium">{String(t.customer_name)}</p>
            <p className="text-xs text-gray-500 truncate">{String(t.message)}</p>
          </button>
        ))}
      </div>
      {selected && (
        <div className="flex-1 bg-white rounded-xl border p-6">
          <h2 className="font-bold text-lg mb-1">{String(selected.customer_name)}</h2>
          <p className="text-sm text-gray-400 mb-4">{String(selected.customer_contact)}</p>
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium mb-1 text-gray-600">고객 문의</p>
            <p className="text-sm">{String(selected.message)}</p>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm font-medium mb-1 text-blue-700">AI 답변</p>
            <p className="text-sm text-blue-900">{String(selected.ai_response)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
