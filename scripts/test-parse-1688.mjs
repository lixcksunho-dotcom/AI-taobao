/**
 * [테스트] parseSearchOffers 를 fixture(fixture-1688-search.json)로 검증
 * fixture = 1688 wirelessrecommend.recommend 실응답(连衣裙 검색, 60건)
 * 종료코드 0=PASS, 1=FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSearchOffers } from './lib-1688.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(dir, '..', 'fixture-1688-search.json')
if (!existsSync(FIX)) { console.error('❌ fixture 없음:', FIX); process.exit(1) }

const json = JSON.parse(readFileSync(FIX, 'utf-8'))
const items = parseSearchOffers(json)

console.log(`파싱 ${items.length}건`)
for (const it of items.slice(0, 6)) {
  console.log(`  ${it.id}  ¥${it.cny}  ${it.isAd ? '[AD]' : '    '}  img:${it.img ? 'O' : 'X'}  ${it.title.slice(0, 42)}`)
}
console.log(`  ... (총 ${items.length}건)`)

const withId    = items.filter(i => i.id).length
const withTitle = items.filter(i => i.title).length
const withPrice = items.filter(i => i.cny > 0).length
const withImg   = items.filter(i => i.img).length
const withUrl   = items.filter(i => /detail\.1688\.com\/offer\/\d+/.test(i.url)).length
console.log(`\nid ${withId}/${items.length} · title ${withTitle}/${items.length} · price ${withPrice}/${items.length} · img ${withImg}/${items.length} · url ${withUrl}/${items.length}`)

const PASS = items.length >= 40 &&
  withId === items.length && withTitle >= items.length - 1 &&
  withPrice >= items.length - 2 && withImg >= items.length - 2 && withUrl === items.length
console.log('\n테스트:', PASS ? '✅ PASS' : '❌ FAIL')
process.exit(PASS ? 0 : 1)
