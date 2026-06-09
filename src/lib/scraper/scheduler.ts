import cron from 'node-cron'
import { scrapeTaobaoProduct } from './taobao'
import { createServiceClient } from '@/lib/supabase/server'

let schedulerStarted = false

export function startScrapeScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  // 매 시간마다 활성화된 스크래핑 작업 확인
  cron.schedule('0 * * * *', async () => {
    const supabase = createServiceClient()
    const { data: jobs } = await supabase
      .from('scrape_jobs')
      .select('*')
      .eq('is_active', true)

    if (!jobs) return

    const now = new Date()
    for (const job of jobs) {
      const lastScraped = job.last_scraped ? new Date(job.last_scraped) : null
      const hoursSince = lastScraped
        ? (now.getTime() - lastScraped.getTime()) / 3600000
        : Infinity

      if (hoursSince >= job.interval_hours) {
        try {
          const product = await scrapeTaobaoProduct(job.url)
          await supabase
            .from('products')
            .upsert({
              taobao_id: product.taobao_id,
              taobao_url: product.taobao_url,
              title_cn: product.title_cn,
              price_cny: product.price_cny,
              images: product.images,
              options: product.options,
              scraped_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: 'taobao_id' })

          await supabase
            .from('scrape_jobs')
            .update({ last_scraped: new Date().toISOString() })
            .eq('id', job.id)
        } catch (err) {
          console.error(`스크래핑 실패 [${job.url}]:`, err)
        }
      }
    }
  })
}
