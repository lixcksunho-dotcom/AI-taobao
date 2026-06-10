/**
 * 1688 새 검색(2024 SPA) 상품 파서
 *
 * 데이터 출처: mtop.relationrecommend.wirelessrecommend.recommend 응답
 *   → .data.data.OFFER.items[].data   (페이지당 ~60건, se_keyword 가 실제 검색어)
 * (1688 홈 검색창 경유 UI 흐름으로 구동해야 이 응답이 채워져 온다)
 *
 * parseSearchOffers(json) : recommend 응답 → [{ id, title, cny, img, url, isAd }]
 */
export function parseSearchOffers(json) {
  const items = (json && json.data && json.data.data && json.data.data.OFFER && json.data.data.OFFER.items) || []
  const out = []
  for (const it of items) {
    const d = it && it.data
    if (!d || !d.offerId) continue
    const id = String(d.offerId)
    const title = d.title || ''
    let img = d.offerPicUrl || (d.offerPic && d.offerPic.pic) || ''
    if (img.startsWith('//')) img = 'https:' + img
    const priceRaw = (d.price && (d.price.price != null ? d.price.price : d.price.frontPriceStr)) || '0'
    const cny = parseFloat(String(priceRaw).replace(/[^\d.]/g, '')) || 0
    // offerId 기반 정규 상품 URL (광고 카드의 dj.1688 리다이렉트가 아니라 실제 상품 페이지)
    const url = `https://detail.1688.com/offer/${id}.html`
    out.push({ id, title, cny, img, url, isAd: !!d.isAd })
  }
  return out
}
