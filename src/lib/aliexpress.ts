import * as crypto from 'node:crypto'

const API_URL = 'https://api-sg.aliexpress.com/sync'

function sign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('')
  return crypto.createHash('md5').update(secret + sorted + secret).digest('hex').toUpperCase()
}

export interface AliProduct {
  taobao_id: string
  taobao_url: string
  title_cn: string
  title_kr: string
  price_usd: number
  price_krw: number
  images: string[]
  options: []
  source: 'aliexpress'
}

export async function searchAliexpress(
  keyword: string,
  page = 1,
  pageSize = 50
): Promise<AliProduct[]> {
  const appKey    = process.env.ALIEXPRESS_APP_KEY ?? ''
  const appSecret = process.env.ALIEXPRESS_APP_SECRET ?? ''
  const rate      = parseFloat(process.env.CNY_TO_KRW_RATE ?? '190')
  const margin    = parseFloat(process.env.MARGIN_RATE ?? '1.3')

  if (!appKey || !appSecret) {
    throw new Error('ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET 환경변수가 없습니다')
  }

  const timestamp = String(Date.now())
  const params: Record<string, string> = {
    method:          'aliexpress.affiliate.product.query',
    app_key:         appKey,
    timestamp,
    sign_method:     'md5',
    v:               '2.0',
    keywords:        keyword,
    page_no:         String(page),
    page_size:       String(pageSize),
    currency:        'USD',
    locale:          'zh_CN',
    ship_to_country: 'KR',
    sort:            'SALE_PRICE_ASC',
  }
  params.sign = sign(params, appSecret)

  const url = API_URL + '?' + new URLSearchParams(params).toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`AliExpress API 오류: ${res.status}`)

  const json = await res.json()
  const products =
    json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product
    ?? []

  const calcKrw = (usd: number) => Math.ceil(usd * 1350 * margin / 100) * 100

  return products.map((p: Record<string, unknown>) => {
    const id    = String(p.product_id ?? '')
    const price = parseFloat(String(p.sale_price ?? p.target_sale_price ?? '0'))
    const img   = String(p.product_main_image_url ?? '')
    const imgs  = (p.product_small_image_urls as Record<string, string[]> | undefined)
      ?.string ?? (img ? [img] : [])

    return {
      taobao_id:  `ali_${id}`,
      taobao_url: `https://www.aliexpress.com/item/${id}.html`,
      title_cn:   String(p.product_title ?? ''),
      title_kr:   '',
      price_usd:  price,
      price_krw:  calcKrw(price),
      images:     imgs,
      options:    [],
      source:     'aliexpress' as const,
    }
  })
}
