import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface TranslationResult {
  title_kr:    string
  keywords_kr: string[]
  options_kr:  { type: string; values: string[] }[]
}

export async function translateProduct(
  title_cn:    string,
  keywords_cn: string[],
  options:     { type: string; values: string[] }[]
): Promise<TranslationResult> {
  const prompt = `다음 중국어 상품 정보를 한국어로 번역하세요.
규칙:
1. 제목은 쇼핑몰에 올릴 자연스러운 한국어로 번역
2. 브랜드 직역 금지 (예: 耐克→나이키 대신 운동화로)
3. 옵션은 색상, 사이즈 등 정확히 번역
4. 키워드는 검색에 쓸 단어들, 3~5개
5. 반드시 JSON만 응답 (설명 없이)

제목: ${title_cn}
옵션: ${JSON.stringify(options)}
키워드: ${keywords_cn.join(', ') || '없음'}

응답 형식:
{
  "title_kr": "번역된 제목",
  "keywords_kr": ["키워드1", "키워드2", "키워드3"],
  "options_kr": [{"type": "색상", "values": ["블랙", "화이트"]}]
}`

  const res = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text : ''
  const json = text.match(/\{[\s\S]*\}/)
  if (!json) throw new Error('번역 JSON 파싱 실패: ' + text.slice(0, 100))

  const parsed = JSON.parse(json[0])
  return {
    title_kr:    parsed.title_kr    ?? '',
    keywords_kr: parsed.keywords_kr ?? [],
    options_kr:  parsed.options_kr  ?? [],
  }
}

/** 제목만 빠르게 번역 (단품 스크래핑용) */
export async function translateTitle(title_cn: string): Promise<string> {
  const res = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages:   [{
      role:    'user',
      content: `중국어 상품 제목을 한국어 쇼핑몰 제목으로 번역. 브랜드명 직역 금지. 제목만 출력(설명 없이):\n${title_cn}`,
    }],
  })
  return res.content[0].type === 'text' ? res.content[0].text.trim() : title_cn
}
