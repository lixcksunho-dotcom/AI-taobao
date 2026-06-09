/**
 * 스크래퍼 직접 테스트 (Next.js 없이)
 * 사용법: node scripts/test-scrape.mjs
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir          = dirname(fileURLToPath(import.meta.url))
const PROFILE      = resolve(dir, '..', '.chrome-profile')
const CHROME_EXE   = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SCREENSHOT   = resolve(dir, '..', 'debug-direct.png')
const HTML_DUMP    = resolve(dir, '..', 'debug-direct.html')

mkdirSync(PROFILE, { recursive: true })

const useChrome = existsSync(CHROME_EXE)
console.log(`브라우저: ${useChrome ? '실제 Chrome' : 'Playwright Chromium'}`)
console.log(`프로필:   ${PROFILE}`)
console.log()

const KEYWORD  = '连衣裙'
const TEST_URL = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(KEYWORD)}&beginPage=1`

console.log('URL:', TEST_URL)
console.log('---')

let context
try {
  context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: useChrome ? CHROME_EXE : undefined,
    headless: true,
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    locale: 'zh-CN',
  })
  console.log('✓ 브라우저 실행 성공')
} catch (err) {
  console.error('✗ 브라우저 실행 실패:', err.message)
  console.error('\n→ Chrome이 이미 실행 중이거나 프로필이 잠겨 있습니다.')
  console.error('  Chrome을 모두 닫고 다시 시도하세요.')
  process.exit(1)
}

const page = await context.newPage()
await page.addInitScript(`
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: {} };
`)

try {
  console.log('페이지 로딩 중...')
  await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))

  const finalUrl   = page.url()
  const title      = await page.title()
  const bodyLength = await page.evaluate(() => document.body?.innerHTML?.length ?? 0)

  console.log('최종 URL  :', finalUrl)
  console.log('페이지 타이틀:', title)
  console.log('Body 크기  :', bodyLength, 'bytes')

  // 스크린샷
  await page.screenshot({ path: SCREENSHOT })
  console.log('스크린샷  :', SCREENSHOT)

  // HTML 저장
  const html = await page.content()
  writeFileSync(HTML_DUMP, html, 'utf-8')
  console.log('HTML 저장 :', HTML_DUMP, `(${html.length} bytes)`)

  // 상품 감지 시도
  const scriptTexts = await page.$$eval('script', els => els.map(s => s.textContent?.slice(0, 100) ?? ''))
  const hasOfferList = scriptTexts.some(t => t.includes('offerList') || t.includes('offer'))
  const itemCount    = await page.$$eval('[class*="offer"], [class*="item"]', els => els.length).catch(() => 0)

  console.log()
  console.log('offerList 스크립트 있음:', hasOfferList)
  console.log('item 요소 개수:', itemCount)

  if (finalUrl.includes('login') || finalUrl.includes('member')) {
    console.log('\n⚠ 로그인 페이지로 리다이렉트됨 → 로그인 필요')
  } else if (bodyLength < 5000) {
    console.log('\n⚠ 페이지 너무 작음 → 봇 차단 또는 오류 페이지')
  } else {
    console.log('\n✓ 페이지 정상 로드됨')
    console.log('  → debug-direct.png 와 debug-direct.html 파일을 확인하세요')
  }
} catch (err) {
  console.error('✗ 에러:', err.message)
} finally {
  await context.close()
}
