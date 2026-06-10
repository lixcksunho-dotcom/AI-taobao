/**
 * 1688 상세페이지 이미지(상세컷) 스크래핑
 * 사용법: node scripts/scrape-detail.mjs <offerId> [headed|headless]
 *   예: node scripts/scrape-detail.mjs 1025649341400
 * 결과: _detailsample/<offerId>/ 에 상세 이미지 다운로드 + 목록 출력
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

chromium.use(StealthPlugin())
const dir = dirname(fileURLToPath(import.meta.url))
const PROFILE = resolve(dir, '..', '.chrome-profile')

const OFFER = (process.argv[2] || '').replace(/^1688_/, '')
const HEADLESS = process.argv[3] === 'headless'
if (!OFFER) { console.error('offerId 필요'); process.exit(1) }

const outDir = resolve(dir, '..', '_detailsample', OFFER)
mkdirSync(outDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: HEADLESS, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
})
const page = await ctx.newPage()

console.log(`상세페이지 진입: offer ${OFFER}`)
await page.goto(`https://detail.1688.com/offer/${OFFER}.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 4000))

// 끝까지 천천히 스크롤하며 lazy 이미지 로드 (설명 모듈은 깊은 스크롤에서 로드)
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.7))
  await new Promise(r => setTimeout(r, 600))
}
await new Promise(r => setTimeout(r, 2000))

// 이미지 수집 — lazy(data-src 류) 포함, alicdn 이미지 전부 (크기는 다운로드 시 바이트로 필터)
const imgs = await page.evaluate(() => {
  const attrs = ['src', 'data-src', 'data-lazy-src', 'data-ks-lazyload', 'data-original', 'data-image']
  const urls = new Set()
  for (const im of document.querySelectorAll('img')) {
    for (const a of attrs) {
      const v = im.getAttribute(a) || ''
      if (/alicdn\.com/.test(v)) urls.add(v.split('?')[0])
    }
  }
  // 설명 컨테이너의 배경이미지도
  for (const el of document.querySelectorAll('[style*="background"]')) {
    const m = (el.getAttribute('style') || '').match(/url\(["']?(https?:\/\/[^"')]*alicdn[^"')]*)/)
    if (m) urls.add(m[1].split('?')[0])
  }
  return [...urls].map(src => ({ src, w: 0, h: 0 }))
})

const title = await page.title().catch(() => '')
console.log(`페이지: ${title.slice(0, 40)}`)
console.log(`상세컷 후보: ${imgs.length}개`)

let n = 0
for (const im of imgs) {
  try {
    const url = im.src.startsWith('//') ? 'https:' + im.src : im.src
    const r = await fetch(url, { headers: { Referer: 'https://detail.1688.com/' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) continue
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 8000) continue  // 너무 작은 건 아이콘
    const ext = (url.match(/\.(jpg|jpeg|png|webp)/i) || [, 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg')
    writeFileSync(resolve(outDir, `d${String(n).padStart(2, '0')}.${ext}`), buf)
    console.log(`  d${String(n).padStart(2, '0')}.${ext}  ${im.w}x${im.h}  ${(buf.length / 1024).toFixed(0)}KB`)
    n++
  } catch { /* skip */ }
}
console.log(`\n다운로드 ${n}개 → ${outDir}`)
await ctx.close()
setTimeout(() => process.exit(0), 300)
