import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type CsCategory = 'shipping' | 'refund' | 'exchange' | 'other'

export interface CsResult {
  category: CsCategory
  ai_response: string
  is_escalated: boolean
}

const CATEGORY_PROMPTS: Record<CsCategory, string> = {
  shipping: '배송 관련 문의입니다. 배송 현황, 예상 도착일, 배송사 정보를 안내해주세요.',
  refund: '환불 관련 문의입니다. 환불 절차와 처리 기간을 안내해주세요.',
  exchange: '교환 관련 문의입니다. 교환 절차와 가능 여부를 안내해주세요.',
  other: '기타 문의입니다. 친절하게 답변해주세요.',
}

export async function handleCsTicket(
  message: string,
  orderInfo?: { order_number?: string; status?: string; tracking_number?: string; tracking_carrier?: string }
): Promise<CsResult> {
  const orderContext = orderInfo
    ? `\n\n[주문 정보]\n- 주문번호: ${orderInfo.order_number ?? '없음'}\n- 상태: ${orderInfo.status ?? '없음'}\n- 운송장: ${orderInfo.tracking_carrier ?? ''} ${orderInfo.tracking_number ?? '없음'}`
    : ''

  // 1단계: 카테고리 분류
  const classifyResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `다음 고객 문의를 카테고리로 분류해. 반드시 shipping/refund/exchange/other 중 하나만 출력해.\n\n문의: ${message}`,
    }],
  })

  const categoryText = classifyResponse.content[0].type === 'text'
    ? classifyResponse.content[0].text.trim().toLowerCase()
    : 'other'

  const category: CsCategory = ['shipping', 'refund', 'exchange', 'other'].includes(categoryText)
    ? categoryText as CsCategory
    : 'other'

  // 2단계: 답변 생성
  const systemPrompt = `당신은 타오바오 구매대행 쇼핑몰의 친절한 CS 담당자입니다. ${CATEGORY_PROMPTS[category]} 답변은 200자 이내로 간결하게 작성하세요.`

  const answerResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `고객 문의: ${message}${orderContext}`,
    }],
  })

  const ai_response = answerResponse.content[0].type === 'text'
    ? answerResponse.content[0].text.trim()
    : '담당자가 확인 후 연락드리겠습니다.'

  // 복잡한 케이스 판별 (환불/교환 + 특정 키워드)
  const escalateKeywords = ['소비자원', '법적', '고소', '사기', '분쟁', '강제']
  const is_escalated = category !== 'other'
    ? escalateKeywords.some(k => message.includes(k))
    : false

  return { category, ai_response, is_escalated }
}
