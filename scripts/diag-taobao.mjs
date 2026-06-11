/**
 * 타오바오 검색결과 엔드포인트 진단 (1회용)
 * s.taobao.com/search 로 직접 가서 내려오는 모든 mtop/json 응답의
 * URL·배열크기·키를 출력하고, 후보를 debug-taobao-all.json 으로 덤프한다.
 * 사용법: node scripts/diag-taobao.mjs "连衣裙"
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

chromium.use(StealthPlugin())
const dir = dirname(fileURLToPath(import.meta.url))
const PROFILE = resolve(dir, '..', '.chrome-profile')
if (!existsSync(PROFILE)) { console.error('❌ .chrome-profile 없음'); process.exit(3) }
mkdirSync(PROFILE, { recursive: true })

const KEYWORD = process.argv[2] || '连衣裙'

// 임의 JSON에서 "객체 배열"들을 찾아 (경로, 길이, 첫원소 키) 요약
function summarizeArrays(root, maxDepth = 14) {
  const out = []
  const seen = new Set()
  function walk(node, path, depth) {
    if (depth > maxDepth || node == null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      const objs = node.filter(e => e && typeof e === 'object' && !Array.isArray(e))
      if (objs.length >= 3) {
        const keys = [...new Set(objs.flatMap(o => Object.keys(o)))].slice(0, 30)
        out.push({ path, len: node.length, objLen: objs.length, keys })
      }
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
    } else {
      for (const k in node) walk(node[k], path ? `${path}.${k}` : k, depth + 1)
    }
  }
  walk(root, '', 0)
  return out
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
})

const dumps = []
function unwrap(b) { const m = b.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/); return m ? m[1] : b }

ctx.on('response', async (res) => {
  const u = res.url()
  if (!/h5api\.m\.taobao|mtop|s\.taobao\.com|acs\./i.test(u)) return
  const ct = res.headers()['content-type'] || ''
  if (!/json|javascript|text/i.test(ct)) return
  let body = ''; try { body = await res.text() } catch { return }
  if (body.length < 50) return
  let json; try { json = JSON.parse(unwrap(body)) } catch { return }
  const arrays = summarizeArrays(json)
  if (!arrays.length) return
  // api 이름 추출
  const api = (json.api) || (u.match(/h5\/([^/]+)/)?.[1]) || u.slice(0, 60)
  console.log(`\n● ${api}`)
  for (const a of arrays.sort((x, y) => y.objLen - x.objLen).slice(0, 4)) {
    console.log(`   배열 ${a.path}  len=${a.len}  objLen=${a.objLen}`)
    console.log(`      keys: ${a.keys.join(', ')}`)
  }
  dumps.push({ url: u, api, json })
})

const page = await ctx.newPage()
console.log(`\n[1] s.taobao.com/search?q=${KEYWORD} 직접 진입...`)
await page.goto(`https://s.taobao.com/search?q=${encodeURIComponent(KEYWORD)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))
console.log('   현재 URL:', page.url().slice(0, 80))
console.log('   타이틀:', (await page.title().catch(() => '')).slice(0, 50))

console.log('[2] 스크롤로 결과 레이지로드 유도...')
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await new Promise(r => setTimeout(r, 1200)) }

await new Promise(r => setTimeout(r, 2000))
const out = resolve(dir, '..', 'debug-taobao-all.json')
writeFileSync(out, JSON.stringify(dumps, null, 2), 'utf-8')
console.log(`\n[3] 후보 응답 ${dumps.length}건 덤프 → ${out}`)
console.log('    (창은 10초 후 닫힘)')
await new Promise(r => setTimeout(r, 10000))
await ctx.close().catch(() => {})
process.exit(0)
