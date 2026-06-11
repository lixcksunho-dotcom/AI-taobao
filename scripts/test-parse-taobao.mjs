/**
 * lib-taobao 파서 검증 — 타오바오가 쓸 수 있는 여러 응답 셰이프를 합성해
 * 구조 자동탐지가 실제 상품 배열을 정확히 골라내는지 확인한다.
 * 사용법: node scripts/test-parse-taobao.mjs   (종료코드 0=PASS)
 */
import { parseSearchItems } from './lib-taobao.mjs'

let fail = 0
const ok = (cond, msg) => { if (!cond) { console.log('  ✗', msg); fail++ } else console.log('  ✓', msg) }

// 셰이프 A: 구버전 s.taobao (mods.itemlist.data.auctions)
const shapeA = {
  data: { mods: { itemlist: { data: { auctions: [
    { nid: '111', raw_title: '여성 원피스 <span>여름</span>', view_price: '199.00', pic_url: '//img.alicdn.com/a.jpg', detail_url: '//item.taobao.com/item.htm?id=111' },
    { nid: '222', raw_title: '린넨 셔츠', view_price: '89.9', pic_url: '//img.alicdn.com/b.jpg' },
  ] } } } },
}

// 셰이프 B: 신버전 mtop (data.itemsArray, 가격이 객체)
const shapeB = {
  data: { itemsArray: [
    { itemId: '333', title: '니트 가디건', priceShow: { price: '129' }, pic: 'https://img.alicdn.com/c.jpg' },
    { itemId: '444', title: '슬랙스', priceShow: { price: '75.50' }, pic: 'https://img.alicdn.com/d.jpg' },
    { itemId: '555', title: '코트', priceShow: { price: '320' }, pic: 'https://img.alicdn.com/e.jpg' },
  ] },
}

// 셰이프 C: 노이즈(추천위젯 배열)가 섞여 있어도 진짜 상품배열을 골라야 함
const shapeC = {
  recommend: { banners: [{ id: 'b1', title: 'AD', img: '//x.jpg' }] }, // id+title뿐, price/img 약함 → 일부만
  result: { items: [
    { auctionId: '666', titleText: '청바지', sortPrice: '59', picUrl: '//img/f.jpg' },
    { auctionId: '777', titleText: '후드티', sortPrice: '49', picUrl: '//img/g.jpg' },
    { auctionId: '888', titleText: '맨투맨', sortPrice: '39', picUrl: '//img/h.jpg' },
    { auctionId: '999', titleText: '조거팬츠', sortPrice: '69', picUrl: '//img/i.jpg' },
  ] },
}

console.log('shape A (구 s.taobao auctions):')
const a = parseSearchItems(shapeA)
ok(a.length === 2, `2건 파싱 (got ${a.length})`)
ok(a[0].id === '111' && a[0].title === '여성 원피스 여름', 'HTML 태그 제거 + id')
ok(a[0].cny === 199, `가격 199 (got ${a[0].cny})`)
ok(a[0].img === 'https://img.alicdn.com/a.jpg', '// → https 보정')
ok(a[0].url.includes('id=111'), 'detail_url 사용')
ok(a[1].url === 'https://item.taobao.com/item.htm?id=222', 'url 없으면 id로 생성')

console.log('shape B (신 mtop itemsArray, 가격객체):')
const b = parseSearchItems(shapeB)
ok(b.length === 3, `3건 파싱 (got ${b.length})`)
ok(b[1].cny === 75.5, `객체가격 추출 75.5 (got ${b[1].cny})`)

console.log('shape C (노이즈 배열 혼재):')
const c = parseSearchItems(shapeC)
ok(c.length === 4, `진짜 상품배열(4건) 선택 (got ${c.length})`)
ok(c.every(x => x.cny > 0), '전부 가격 보유')

console.log('빈/이상 입력:')
ok(parseSearchItems(null).length === 0, 'null → []')
ok(parseSearchItems({}).length === 0, '{} → []')

console.log(fail === 0 ? '\n✅ 전체 PASS' : `\n❌ ${fail}건 FAIL`)
process.exit(fail === 0 ? 0 : 1)
