/**
 * 세션 로그인 (1회용) — 타오바오 / 1688 둘 다 지원
 *
 * 실제 Chrome 창을 띄워 로그인하면 .chrome-profile/ 에 세션 쿠키가
 * 영구 저장된다. 이후 scrape-auto.mjs 가 이 세션을 재사용해 무인 수집한다.
 * 세션은 수 주간 유지되므로 평소엔 다시 실행할 필요가 없다.
 *
 * 사용법:
 *   node scripts/session-login.mjs            (기본: 1688)
 *   node scripts/session-login.mjs taobao
 *   node scripts/session-login.mjs 1688
 */

import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

chromium.use(StealthPlugin())

const dir     = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(dir, '..', '.chrome-profile')
mkdirSync(dataDir, { recursive: true })

const SOURCE = (process.argv[2] ?? '1688').toLowerCase()
if (!['taobao', '1688'].includes(SOURCE)) {
  console.error(`❌ 소스는 taobao 또는 1688 이어야 합니다. (입력: ${SOURCE})`)
  process.exit(1)
}

const CFG = {
  taobao: {
    login:  'https://login.taobao.com/member/login.jhtml',
    leave:  'login.taobao.com',
    search: 'https://s.taobao.com/search?q=test',
    keys:   ['unb', 'tracknick', 'cookie2', '_tb_token_', 't'],
  },
  '1688': {
    login:  'https://login.1688.com/member/signin.htm',
    leave:  'login.1688.com',
    search: 'https://s.1688.com/selloffer/offer_search.htm?keywords=test&beginPage=1',
    keys:   ['unb', 'cookie2', '_tb_token_', '__cn_logon__'],
  },
}[SOURCE]

console.log('═'.repeat(56))
console.log(` 세션 로그인 — ${SOURCE}  (실제 Chrome)`)
console.log('═'.repeat(56))
console.log(' 창에서 로그인(QR 스캔 또는 비번)을 완료하세요.')
console.log(' 로그인이 감지되면 자동으로 세션을 저장합니다.\n')

const context = await chromium.launchPersistentContext(dataDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars'],
  ignoreDefaultArgs: ['--enable-automation'],
  locale: 'zh-CN',
})

const page = await context.newPage()
await page.goto(CFG.login, { waitUntil: 'domcontentloaded' })

// 로그인 완료 대기 (로그인 페이지를 벗어날 때까지, 최대 3분)
try {
  await page.waitForFunction(
    (leave) => !location.href.includes(leave),
    CFG.leave,
    { timeout: 180_000 }
  )
  console.log('✓ 로그인 감지 — 세션 확립 중...')
} catch {
  console.log('⏱ 3분 타임아웃 — 현재 상태로 저장을 시도합니다.')
}

// 검색 페이지까지 방문해 세션을 완전히 확립
await page.goto(CFG.search, { waitUntil: 'domcontentloaded' }).catch(() => {})
await new Promise(r => setTimeout(r, 3000))

const blocked = /punish|captcha/.test(page.url()) || /验证|拦截/.test(await page.title().catch(() => ''))
if (blocked) {
  console.log('⚠ 검색 페이지에서 캡차가 떴습니다 — 창에서 직접 풀고 30초 대기합니다...')
  await new Promise(r => setTimeout(r, 30_000))
}

// 핵심 쿠키 확인
const cookies = await context.cookies()
const found   = CFG.keys.filter(n => cookies.some(c => c.name === n))
const missing = CFG.keys.filter(n => !cookies.some(c => c.name === n))

console.log()
if (found.length === 0) {
  console.log('❌ 로그인 쿠키가 하나도 없습니다 — 로그인이 완료됐는지 확인 후 재실행하세요.')
  await context.close()
  process.exit(1)
}

console.log(`✅ ${SOURCE} 세션 저장 완료!`)
console.log(`   확인된 쿠키: ${found.join(', ')}`)
if (missing.length) console.log(`   미확인:     ${missing.join(', ')}  ${missing.length === CFG.keys.length ? '' : '(일부 미확인은 정상일 수 있음)'}`)
console.log(`   저장 위치:  .chrome-profile/`)
console.log()
console.log(`이제 무인 수집을 실행하세요:`)
console.log(`   node scripts/scrape-auto.mjs "키워드" 페이지수 ${SOURCE}`)

await context.close()
process.exitCode = 0
