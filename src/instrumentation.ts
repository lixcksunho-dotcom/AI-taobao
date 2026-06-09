/**
 * Next.js 서버 시작 시 1회 실행 (instrumentation hook)
 * - 매시간 파이프라인 자동 실행
 * - npm run dev / npm start 하면 자동 활성화
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { default: cron } = await import('node-cron')
  const { processPending }  = await import('./lib/product-pipeline')

  const fmt = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  console.log('[자동화] 파이프라인 스케줄러 시작 — 매시간 정각 실행')

  // 매시간 정각 (0분)
  cron.schedule('0 * * * *', async () => {
    console.log(`\n[파이프라인 ${fmt()}] 자동 실행 시작...`)
    try {
      const result = await processPending(100)
      console.log(
        `[파이프라인 완료] 통과: ${result.passed}  차단: ${result.blocked}  오류: ${result.errors}`
      )
    } catch (err) {
      console.error('[파이프라인 오류]', (err as Error).message)
    }
  }, { timezone: 'Asia/Seoul' })

  // 서버 시작 후 10초 뒤 미처리 상품이 있으면 즉시 1회 실행
  setTimeout(async () => {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { count } = await sb
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('trademark_status', 'pending')

      if (count && count > 0) {
        console.log(`[파이프라인] 서버 시작 — pending ${count}개 발견, 즉시 처리 시작`)
        const result = await processPending(100)
        console.log(`[파이프라인 완료] 통과: ${result.passed}  차단: ${result.blocked}  오류: ${result.errors}`)
      }
    } catch (err) {
      console.error('[파이프라인 초기 실행 오류]', (err as Error).message)
    }
  }, 10_000)
}
