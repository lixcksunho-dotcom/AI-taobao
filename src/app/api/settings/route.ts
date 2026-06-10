import { NextResponse } from 'next/server'

// 환경변수 "설정 여부"(값은 노출 안 함)와 비밀이 아닌 가격 설정값을 반환
export async function GET() {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim())

  const env = [
    { key: 'NEXT_PUBLIC_SUPABASE_URL',  label: 'Supabase URL',         desc: 'DB 연결',         set: has('NEXT_PUBLIC_SUPABASE_URL'), required: true },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Key', desc: 'DB 쓰기 권한',    set: has('SUPABASE_SERVICE_ROLE_KEY'), required: true },
    { key: 'ANTHROPIC_API_KEY',         label: 'Claude API Key',       desc: '번역·CS 자동응답', set: has('ANTHROPIC_API_KEY'), required: true },
    { key: 'ALIGO_KEY',                 label: 'Aligo Key',            desc: '카카오 알림톡',    set: has('ALIGO_KEY'), required: false },
    { key: 'ALIEXPRESS_APP_KEY',        label: 'AliExpress App Key',   desc: '대안 상품 수집',   set: has('ALIEXPRESS_APP_KEY'), required: false },
    { key: 'PROXY_SERVER',              label: 'Proxy Server',         desc: '스크래퍼 프록시(선택)', set: has('PROXY_SERVER'), required: false },
  ]

  const pricing = {
    cnyToKrw:     Number(process.env.CNY_TO_KRW_RATE ?? 190),
    shippingFee:  Number(process.env.SHIPPING_FEE_KRW ?? 5000),
    coupangFee:   Number(process.env.COUPANG_FEE_RATE ?? 0.105),
    marginRate:   Number(process.env.TARGET_MARGIN_RATE ?? 0.30),
  }

  return NextResponse.json({ env, pricing })
}
