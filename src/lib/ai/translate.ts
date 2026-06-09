import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function translateProductTitle(titleCn: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `다음 중국어 상품명을 한국어로 자연스럽게 번역해줘. 번역문만 출력해. 설명 없이.\n\n${titleCn}`,
    }],
  })

  const content = message.content[0]
  return content.type === 'text' ? content.text.trim() : titleCn
}

export function calculateKrwPrice(
  priceCny: number,
  rate: number = Number(process.env.CNY_TO_KRW_RATE ?? 190),
  marginRate: number = Number(process.env.MARGIN_RATE ?? 1.3)
): number {
  return Math.ceil((priceCny * rate * marginRate) / 100) * 100
}
