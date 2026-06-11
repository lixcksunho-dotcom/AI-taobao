/**
 * 타오바오 상세페이지 API 셰이프 진단 (1회용)
 * item.taobao.com/item.htm?id=<id> 진입 → mtop 응답 중 이미지/SKU 담긴 것 탐지·덤프
 * 사용법: node scripts/diag-taobao-detail.mjs <itemId>
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

const ID = (process.argv[2] || '').replace(/^taobao_/, '')
if (!ID) { console.error('itemId 필요'); process.exit(1) }

function unwrap(b) { const m = b.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/); return m ? m[1] : b }

// JSON에서 (a) 이미지 URL 문자열배열, (b) 'sku/prop/색상' 키 가진 노드 위치 요약
function probe(root, maxDepth = 16) {
  const imgArrays = [], skuNodes = []
  const seen = new Set()
  function walk(node, path, depth) {
    if (depth > maxDepth || node == null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      const imgs = node.filter(v => typeof v === 'string' && /\.(jpg|jpeg|png|webp)/i.test(v) && /alicdn|taobao|tmall/i.test(v))
      if (imgs.length >= 2) imgArrays.push({ path, len: node.length, imgLen: imgs.length, sample: imgs[0] })
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
    } else {
      const keys = Object.keys(node)
      if (keys.some(k => /^(skuBase|skus|props|propPath|sku2info|skuCore)$/i.test(k)) ||
          (keys.includes('name') && keys.includes('values'))) {
        skuNodes.push({ path, keys: keys.slice(0, 20) })
      }
      for (const k of keys) walk(node[k], path ? `${path}.${k}` : k, depth + 1)
    }
  }
  walk(root, '', 0)
  return { imgArrays, skuNodes }
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation'],
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }, locale: 'zh-CN',
})
const dumps = []
ctx.on('response', async (res) => {
  const u = res.url()
  if (!/h5api\.m\.taobao|mtop|detail/i.test(u)) return
  const ct = res.headers()['content-type'] || ''
  if (!/json|javascript|text/i.test(ct)) return
  let body = ''; try { body = await res.text() } catch { return }
  if (body.length < 100) return
  let json; try { json = JSON.parse(unwrap(body)) } catch { return }
  const api = json.api || u.match(/h5\/([^/]+)/)?.[1] || u.slice(0, 50)
  const { imgArrays, skuNodes } = probe(json)
  if (imgArrays.length || skuNodes.length) {
    console.log(`\n● ${api}`)
    for (const a of imgArrays.sort((x, y) => y.imgLen - x.imgLen).slice(0, 5))
      console.log(`   IMG 배열 ${a.path}  imgs=${a.imgLen}  ${a.sample.slice(0, 60)}`)
    for (const s of skuNodes.slice(0, 8))
      console.log(`   SKU 노드 ${s.path}  keys: ${s.keys.join(',')}`)
    dumps.push({ url: u.slice(0, 80), api, json })
  }
})

const page = await ctx.newPage()
console.log(`상세 진입: item ${ID}`)
await page.goto(`https://item.taobao.com/item.htm?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))
console.log('URL:', page.url().slice(0, 70), '| 타이틀:', (await page.title().catch(() => '')).slice(0, 40))
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await new Promise(r => setTimeout(r, 900)) }
await new Promise(r => setTimeout(r, 2000))

const out = resolve(dir, '..', 'debug-taobao-detail.json')
writeFileSync(out, JSON.stringify(dumps, null, 2), 'utf-8')
console.log(`\n덤프 ${dumps.length}건 → ${out} (창 8초후 닫힘)`)
await new Promise(r => setTimeout(r, 8000))
await ctx.close().catch(() => {})
process.exit(0)
