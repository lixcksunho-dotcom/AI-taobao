import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clearCache } from '@/lib/trademark'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// 전체 목록 조회
export async function GET() {
  const { data, error } = await sb()
    .from('trademark_blocks')
    .select('*')
    .order('category')
    .order('keyword')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 추가
export async function POST(req: NextRequest) {
  const { keyword, lang = 'all', category = 'brand', note = '' } = await req.json()
  if (!keyword?.trim()) return NextResponse.json({ error: '키워드 필요' }, { status: 400 })

  const { data, error } = await sb()
    .from('trademark_blocks')
    .insert({ keyword: keyword.trim().toLowerCase(), lang, category, note })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  clearCache()
  return NextResponse.json(data)
}

// 삭제
export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const { error } = await sb().from('trademark_blocks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  clearCache()
  return NextResponse.json({ ok: true })
}
