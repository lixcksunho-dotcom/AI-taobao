/**
 * Supabase DB 스키마 적용 스크립트
 * 사용법: node scripts/apply-schema.mjs
 * (프로젝트 루트의 .env.local 값을 사용합니다)
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const dir = dirname(fileURLToPath(import.meta.url))

// .env.local 파싱
function loadEnv() {
  const envPath = resolve(dir, '..', '.env.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) env[match[1].trim()] = match[2].trim()
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || SUPABASE_URL.includes('xxxx')) {
  console.error('❌ .env.local에 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.')
  process.exit(1)
}

// 스키마를 개별 SQL 구문으로 분리
const schemaPath = resolve(dir, '..', 'supabase', 'schema.sql')
const schemaSql = readFileSync(schemaPath, 'utf-8')

// SQL 구문 분리 (함수 블디 내부의 ;는 건드리지 않도록)
function splitStatements(sql) {
  const statements = []
  let current = ''
  let dollarDepth = 0

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--')) { current += '\n'; continue }

    if (trimmed.includes('$$')) {
      dollarDepth += (trimmed.match(/\$\$/g) || []).length
    }

    current += line + '\n'

    if (dollarDepth % 2 === 0 && trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt && stmt !== ';') statements.push(stmt)
      current = ''
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements.filter(Boolean)
}

async function runQuery(sql) {
  // Supabase REST API로 RPC 호출은 DDL 불가 → pg_meta API 사용
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  return response
}

async function applyViaManagementApi(sql) {
  // Supabase Management API (project ref 추출)
  const ref = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '')
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  return response
}

async function main() {
  console.log('=== Supabase 스키마 적용 ===')
  console.log('URL:', SUPABASE_URL)
  console.log()

  const statements = splitStatements(schemaSql)
  console.log(`총 ${statements.length}개 구문 실행 예정\n`)

  let success = 0
  let failed = 0

  for (const stmt of statements) {
    const preview = stmt.split('\n')[0].slice(0, 60)
    process.stdout.write(`  ${preview}... `)

    try {
      // Management API 먼저 시도
      const res = await applyViaManagementApi(stmt)
      const body = await res.text()

      if (res.ok || body.includes('already exists') || body.includes('42P07')) {
        console.log('✓')
        success++
      } else {
        console.log('✗')
        console.log('    응답:', body.slice(0, 200))
        failed++
      }
    } catch (err) {
      console.log('✗', err.message.slice(0, 80))
      failed++
    }
  }

  console.log(`\n완료: 성공 ${success} / 실패 ${failed}`)

  if (failed > 0) {
    console.log('\n⚠️  일부 구문 실패 — Supabase SQL Editor에서 직접 실행이 필요합니다:')
    console.log('   https://supabase.com/dashboard/project/mjvupcxqxefgbjarntka/editor')
    console.log('   파일: supabase/schema.sql 내용을 붙여넣기 후 Run')
  } else {
    console.log('\n✅ 모든 테이블 생성 완료!')
  }
}

main().catch(err => {
  console.error('오류:', err.message)
  process.exit(1)
})
