import { createClient } from '@supabase/supabase-js'

interface TrademarkBlock {
  keyword: string
  lang: string
  category: string
}

// 메모리 캐시 (60초)
let cache: TrademarkBlock[] = []
let cacheTime = 0

async function getBlocks(): Promise<TrademarkBlock[]> {
  if (Date.now() - cacheTime < 60_000 && cache.length > 0) return cache

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('trademark_blocks')
    .select('keyword, lang, category')
  cache = data ?? []
  cacheTime = Date.now()
  return cache
}

export function clearCache() { cacheTime = 0 }

export interface CheckResult {
  blocked: boolean
  matched: string[]
}

/**
 * 텍스트에서 차단 키워드 탐색
 * @param text   검사할 텍스트
 * @param lang   텍스트 언어 'cn' | 'kr' | 'en'
 */
export async function checkTrademark(text: string, lang: 'cn' | 'kr' | 'en'): Promise<CheckResult> {
  if (!text) return { blocked: false, matched: [] }

  const blocks = await getBlocks()
  const lower  = text.toLowerCase()
  const matched: string[] = []

  for (const b of blocks) {
    if (b.lang !== 'all' && b.lang !== lang) continue

    const kw = b.keyword.toLowerCase()

    // 단어 경계 체크: 영문은 공백/구두점, CJK는 그냥 포함 여부
    const isCJK = /[㐀-鿿가-퟿]/.test(b.keyword)
    if (isCJK) {
      if (lower.includes(kw)) matched.push(b.keyword)
    } else {
      // 영문: 단어 경계 정규식 (\b 사용)
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      if (re.test(text)) matched.push(b.keyword)
    }
  }

  return { blocked: matched.length > 0, matched }
}

/**
 * 텍스트에서 차단 키워드를 제거 (단어 삭제)
 */
export async function sanitizeText(text: string, lang: 'cn' | 'kr' | 'en'): Promise<string> {
  const { matched } = await checkTrademark(text, lang)
  if (matched.length === 0) return text

  let result = text
  for (const kw of matched) {
    const isCJK = /[㐀-鿿가-퟿]/.test(kw)
    if (isCJK) {
      result = result.replace(new RegExp(kw, 'gi'), '')
    } else {
      result = result.replace(
        new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
        ''
      )
    }
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

/**
 * 키워드 배열에서 차단 항목 제거
 */
export async function sanitizeKeywords(
  keywords: string[],
  lang: 'cn' | 'kr' | 'en'
): Promise<string[]> {
  const clean: string[] = []
  for (const kw of keywords) {
    const { blocked } = await checkTrademark(kw, lang)
    if (!blocked) clean.push(kw)
  }
  return clean
}

/** block_count 증가 */
export async function incrementBlockCount(keywords: string[]) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  for (const kw of keywords) {
    await supabase.rpc('increment_block_count', { kw })
  }
}
