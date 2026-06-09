#!/usr/bin/env node
/**
 * Git이 없는 PC에서 GitHub으로 코드를 올리는 스크립트
 *
 * 사용법:
 *   node scripts/push-to-github.mjs <GitHub_레포_URL> <Personal_Access_Token>
 *
 * 예시:
 *   node scripts/push-to-github.mjs https://github.com/username/taobao-auto-platform.git ghp_xxxxx
 *
 * GitHub PAT 발급: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
 * 필요 권한: repo (전체)
 */

// 회사 네트워크 SSL 검사 우회 (self-signed cert 오류 방지)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , remoteUrl, token] = process.argv

if (!remoteUrl || !token) {
  console.error('사용법: node scripts/push-to-github.mjs <레포URL> <GitHub토큰>')
  console.error('예시:   node scripts/push-to-github.mjs https://github.com/user/repo.git ghp_xxxxx')
  process.exit(1)
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const author = { name: 'taobao-admin', email: 'admin@taobao-platform.local' }

// 대용량/민감 폴더는 스킵
const SKIP = new Set(['.git', 'node_modules', '.next', 'out', 'build', 'coverage', '.vercel'])

async function addFiles(baseDir, currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue

    const absPath = path.join(currentDir, entry.name)
    const relPath = path.relative(baseDir, absPath).replace(/\\/g, '/')

    // .env 파일 (실제 키가 있으므로 절대 올리지 않음)
    if (entry.name.startsWith('.env') && !entry.name.endsWith('.example')) continue

    try {
      const ignored = await git.isIgnored({ fs, dir: baseDir, filepath: relPath })
      if (ignored) continue
    } catch {
      // isIgnored 실패시 그냥 추가
    }

    if (entry.isDirectory()) {
      await addFiles(baseDir, absPath)
    } else {
      await git.add({ fs, dir: baseDir, filepath: relPath })
    }
  }
}

async function main() {
  console.log('=== 타오바오 플랫폼 GitHub 동기화 ===\n')

  // 1. git init (이미 있으면 스킵)
  const gitDir = path.join(dir, '.git')
  if (!fs.existsSync(gitDir)) {
    await git.init({ fs, dir, defaultBranch: 'main' })
    console.log('[1/5] git 저장소 초기화 완료')
  } else {
    console.log('[1/5] 기존 git 저장소 사용')
  }

  // 2. 파일 스테이징
  process.stdout.write('[2/5] 파일 스테이징 중...')
  await addFiles(dir, dir)
  console.log(' 완료')

  // 3. 변경 여부 확인 후 커밋
  const status = await git.statusMatrix({ fs, dir })
  const changed = status.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))

  if (changed.length > 0) {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    await git.commit({
      fs,
      dir,
      message: `sync: ${now} 작업 동기화 (${changed.length}개 파일)`,
      author,
    })
    console.log(`[3/5] 커밋 완료 (변경 ${changed.length}개 파일)`)
  } else {
    console.log('[3/5] 변경사항 없음 — 이전 커밋 그대로 push')
  }

  // 4. remote 설정
  try {
    await git.addRemote({ fs, dir, remote: 'origin', url: remoteUrl })
  } catch {
    await git.setConfig({ fs, dir, path: 'remote.origin.url', value: remoteUrl })
  }
  console.log('[4/5] remote origin 설정:', remoteUrl)

  // 5. push
  process.stdout.write('[5/5] GitHub으로 push 중...')
  await git.push({
    fs,
    http,
    dir,
    remote: 'origin',
    ref: 'main',
    force: false,
    onAuth: () => ({ username: 'x-token', password: token }),
    onProgress: evt => {
      if (evt.phase) process.stdout.write('.')
    },
  })
  console.log('\n')
  console.log('✅ GitHub push 완료!')
  console.log('   ', remoteUrl)
  console.log('\n집에서 이어받기:')
  console.log('  git clone', remoteUrl)
  console.log('  cd taobao-auto-platform')
  console.log('  npm install')
  console.log('  cp .env.example .env.local  # 환경변수 입력 후 실행')
  console.log('  npm run dev')
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message)
  if (err.message?.includes('401') || err.message?.includes('403')) {
    console.error('   → GitHub 토큰을 확인하세요 (repo 권한 필요)')
  } else if (err.message?.includes('404')) {
    console.error('   → 레포지토리 URL이 올바른지 확인하세요')
  } else if (err.message?.includes('rejected')) {
    console.error('   → 원격에 더 새로운 커밋이 있습니다. --force 옵션이 필요할 수 있습니다.')
  }
  process.exit(1)
})
