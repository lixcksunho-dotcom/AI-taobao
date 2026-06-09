/**
 * 타오바오 로그인 — 실제 Chrome으로 전용 프로필에 저장
 * 사용법: node scripts/taobao-login.mjs
 */

import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

chromium.use(StealthPlugin())

const dir      = dirname(fileURLToPath(import.meta.url))
const dataDir  = resolve(dir, '..', '.chrome-profile')   // 전용 Chrome 프로필
mkdirSync(dataDir, { recursive: true })

console.log('=== 타오바오 로그인 (실제 Chrome) ===')
console.log('브라우저 창에서 타오바오에 로그인하세요.')
console.log('로그인 완료 후 창을 그대로 두면 자동으로 저장됩니다.\n')

// 실제 Chrome 바이너리 + 전용 persistent 프로필
const context = await chromium.launchPersistentContext(dataDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
})

const page = await context.newPage()

await page.goto('https://login.taobao.com/member/login.jhtml', {
  waitUntil: 'domcontentloaded',
})

// 로그인 완료 대기 (login 페이지 벗어날 때)
try {
  await page.waitForFunction(
    () => !location.href.includes('login.taobao.com'),
    { timeout: 180_000 }
  )
  console.log('로그인 감지 — 쿠키 확립 중...')
} catch {
  console.log('3분 타임아웃 — 현재 상태로 저장합니다.')
}

// 메인 페이지 + 검색 페이지까지 방문해 세션 완전 확립
await page.goto('https://www.taobao.com', { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 3000))

await page.goto('https://s.taobao.com/search?q=test', { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 3000))

// 핵심 쿠키 확인
const cookies = await context.cookies()
const KEY = ['unb', 'tracknick', 'uc3', 'cookie2', '_tb_token_', 't']
const found   = KEY.filter(n => cookies.some(c => c.name === n))
const missing = KEY.filter(n => !cookies.some(c => c.name === n))

if (found.length === 0) {
  console.log('\n❌ 로그인 쿠키 없음 — 로그인이 완료됐는지 확인 후 재실행하세요.')
  await context.close()
  process.exit(1)
}

console.log(`\n✅ 로그인 완료!`)
console.log(`   확인된 쿠키: ${found.join(', ')}`)
if (missing.length) console.log(`   미확인: ${missing.join(', ')}`)
console.log(`   프로필 저장 위치: .chrome-profile/`)
console.log('\n이제 서버에서 스크래퍼를 실행하면 이 프로필을 사용합니다.')

await context.close()
