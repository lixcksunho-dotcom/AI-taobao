/**
 * 타오바오 검색 상품 파서 (구조 자동탐지형)
 *
 * 1688과 달리 타오바오 데스크톱 검색(s.taobao.com)도 2024 SPA화되어
 * 결과가 mtop(h5api.m.taobao.com) 응답으로 내려온다. 다만 응답 JSON의
 * 정확한 경로는 버전마다 바뀌므로 — 경로를 하드코딩하지 않고
 * "상품처럼 생긴 객체들의 배열"을 JSON 안에서 구조적으로 찾아낸다.
 *
 * parseSearchItems(json) : 임의의 mtop 응답 → [{ id, title, cny, img, url }]
 */

// 후보 필드명 (타오바오는 버전/엔드포인트마다 키가 다르다)
const ID_KEYS    = ['itemId', 'item_id', 'auctionId', 'nid', 'itemNumId', 'id']
const TITLE_KEYS = ['title', 'raw_title', 'rawTitle', 'name', 'titleText', 'pcTitle']
const PRICE_KEYS = ['price', 'priceShow', 'sortPrice', 'view_price', 'reservePrice',
                    'priceWap', 'realPrice', 'priceInfo']
const IMG_KEYS   = ['pic', 'picUrl', 'pic_url', 'img', 'imgUrl', 'image', 'pic_path',
                    'mainPic', 'picPath']
const URL_KEYS   = ['detail_url', 'detailUrl', 'auctionURL', 'itemUrl', 'url']

function pick(obj, keys) {
  for (const k of keys) {
    if (obj == null) return undefined
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

// 가격: "¥199.00", "199", {priceText:"199"} 등 다양한 형태에서 숫자 추출
function toCny(raw) {
  if (raw == null) return 0
  if (typeof raw === 'object') {
    raw = raw.price ?? raw.priceText ?? raw.value ?? raw.amount ?? raw.startPrice ?? ''
  }
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function normUrl(u) {
  if (!u) return ''
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('http')) return u
  return ''
}

// 객체가 "상품"처럼 보이는지 점수화 (id + title + (price|img) 정도면 상품)
function looksLikeItem(o) {
  if (!o || typeof o !== 'object') return false
  const hasId    = pick(o, ID_KEYS) != null
  const hasTitle = pick(o, TITLE_KEYS) != null
  const hasPrice = pick(o, PRICE_KEYS) != null
  const hasImg   = pick(o, IMG_KEYS) != null
  return hasId && hasTitle && (hasPrice || hasImg)
}

// JSON 트리를 훑어 "상품 객체 배열" 후보들을 모은다 (가장 그럴듯한 것 선택)
function findItemArrays(root, maxDepth = 12) {
  const found = [] // { arr, score }
  const seen = new Set()
  function walk(node, depth) {
    if (depth > maxDepth || node == null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      if (node.length) {
        const itemish = node.filter(looksLikeItem).length
        if (itemish >= Math.max(2, node.length * 0.5)) {
          found.push({ arr: node, score: itemish })
        }
      }
      for (const v of node) walk(v, depth + 1)
    } else {
      for (const k in node) walk(node[k], depth + 1)
    }
  }
  walk(root, 0)
  // 상품 개수(score) 큰 배열 우선
  found.sort((a, b) => b.score - a.score)
  return found
}

export function parseSearchItems(json) {
  const arrays = findItemArrays(json)
  if (!arrays.length) return []
  const items = arrays[0].arr
  const out = []
  const seenIds = new Set()
  for (const it of items) {
    if (!looksLikeItem(it)) continue
    const id = String(pick(it, ID_KEYS))
    if (!id || seenIds.has(id)) continue
    seenIds.add(id)
    const title = String(pick(it, TITLE_KEYS) || '').replace(/<[^>]+>/g, '').trim()
    const cny   = toCny(pick(it, PRICE_KEYS))
    const img   = normUrl(String(pick(it, IMG_KEYS) || ''))
    const url   = normUrl(String(pick(it, URL_KEYS) || '')) ||
                  `https://item.taobao.com/item.htm?id=${id}`
    out.push({ id, title, cny, img, url })
  }
  return out
}
