/**
 * 상품 상세페이지 HTML 생성
 *
 * 어젯밤 번역한 상세컷 이미지(images[1..])와 한국어 상세설명을 합쳐
 * 스마트스토어/쿠팡/자체몰에 그대로 붙여넣을 수 있는 HTML을 만든다.
 *
 * - description_kr 컬럼이 없어 상세설명은 category 컬럼에 저장돼 있음(generate-descriptions.mjs 참고)
 * - images[0] = 대표 썸네일, images[1..] = 번역된 상세컷
 */

export interface DetailProduct {
  title_kr?: string | null
  title_cn?: string | null
  category?: string | null      // 실제로는 한국어 상세설명 본문이 들어있음
  keywords_kr?: string[] | null
  options?: { type: string; values: string[] }[] | null
  options_kr?: { type: string; values: string[] }[] | null
  images?: string[] | null
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const TYPE_KR: Record<string, string> = {
  color: '색상', colour: '색상', 颜色: '색상', 颜色分类: '색상',
  size: '사이즈', 尺码: '사이즈', 尺寸: '사이즈',
}

/** 채워진 옵션 컬럼을 고르고(options_kr 우선, 없으면 options) 종류명을 한국어로 정규화 */
export function pickOptions(p: DetailProduct): { type: string; values: string[] }[] {
  const kr = p.options_kr
  const src = Array.isArray(kr) && kr.length ? kr : (Array.isArray(p.options) ? p.options : [])
  return src.map(g => ({
    type: TYPE_KR[(g.type || '').trim().toLowerCase()] ?? g.type,
    values: g.values,
  }))
}

/** 상세설명 본문(category)을 간단 마크다운(•, **굵게**, 줄바꿈) → HTML 변환 */
function descToHtml(desc: string): string {
  const lines = desc.split('\n').map(l => l.trim())
  const html: string[] = []
  let inList = false
  for (const line of lines) {
    if (!line) { if (inList) { html.push('</ul>'); inList = false } continue }
    const bullet = line.match(/^[•\-*]\s*(.+)$/)
    if (bullet) {
      if (!inList) { html.push('<ul style="margin:12px 0;padding-left:20px;line-height:1.9;">'); inList = true }
      html.push(`<li>${inlineMd(bullet[1])}</li>`)
    } else {
      if (inList) { html.push('</ul>'); inList = false }
      html.push(`<p style="margin:10px 0;line-height:1.8;">${inlineMd(line)}</p>`)
    }
  }
  if (inList) html.push('</ul>')
  return html.join('\n')
}

function inlineMd(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

/**
 * 상품 → 업로드용 상세페이지 HTML 문자열.
 * 인라인 스타일만 사용(쇼핑몰 에디터가 외부 CSS/클래스를 거르므로).
 */
export function buildDetailHtml(p: DetailProduct): string {
  const title = (p.title_kr || p.title_cn || '').trim()
  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : []
  // 상세컷(번역본)은 images[1..]. 1장뿐이면 그 1장이라도 사용.
  const detailImgs = images.length > 1 ? images.slice(1) : images
  const desc = (p.category || '').trim()
  const opts = pickOptions(p)

  const parts: string[] = []
  parts.push('<div style="max-width:860px;margin:0 auto;font-family:\'맑은 고딕\',Malgun Gothic,sans-serif;color:#222;">')

  if (title) {
    parts.push(`<h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">${esc(title)}</h2>`)
  }

  if (desc) {
    parts.push('<section style="margin-bottom:24px;">')
    parts.push(descToHtml(desc))
    parts.push('</section>')
  }

  if (opts.length) {
    parts.push('<section style="margin:20px 0;padding:16px;background:#f8f8fa;border-radius:10px;">')
    parts.push('<p style="font-weight:700;margin:0 0 10px;">옵션 안내</p>')
    for (const g of opts) {
      parts.push(`<p style="margin:4px 0;"><strong>${esc(g.type)}</strong> : ${esc((g.values || []).join(' / '))}</p>`)
    }
    parts.push('</section>')
  }

  if (detailImgs.length) {
    parts.push('<section style="margin-top:8px;">')
    for (const src of detailImgs) {
      parts.push(`<img src="${esc(src)}" alt="${esc(title)}" style="display:block;width:100%;max-width:860px;margin:0 auto;" loading="lazy">`)
    }
    parts.push('</section>')
  }

  parts.push('</div>')
  return parts.join('\n')
}
