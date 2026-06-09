-- ================================================
-- 타오바오 자동화 플랫폼 DB 스키마
-- Supabase SQL Editor에서 전체 실행
-- ================================================

-- updated_at 자동 갱신 함수
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ──────────────────────────────────────
-- 1. 상품 테이블
-- ──────────────────────────────────────
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  taobao_id    text unique not null,
  taobao_url   text not null,
  title_cn     text,
  title_kr     text,
  price_cny    numeric,
  price_krw    numeric,
  images       jsonb default '[]',
  options      jsonb default '[]',
  stock_status text default 'available',  -- available / inactive / out_of_stock
  category     text,
  scraped_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_products_stock_status on products(stock_status);
create index if not exists idx_products_scraped_at   on products(scraped_at desc);

create or replace trigger trg_products_updated_at
  before update on products
  for each row execute function update_updated_at();

-- ──────────────────────────────────────
-- 2. 주문 테이블
-- ──────────────────────────────────────
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text unique not null,
  customer_name    text,
  customer_phone   text,
  customer_email   text,
  shipping_address text,
  items            jsonb not null default '[]',
  total_krw        numeric,
  status           text default 'pending',
  -- pending → paid → ordering → shipping → delivered → done
  taobao_order_id  text,
  tracking_number  text,
  tracking_carrier text,
  paid_at          timestamptz,
  shipped_at       timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists idx_orders_status     on orders(status);
create index if not exists idx_orders_created_at on orders(created_at desc);
create index if not exists idx_orders_phone      on orders(customer_phone);

create or replace trigger trg_orders_updated_at
  before update on orders
  for each row execute function update_updated_at();

-- ──────────────────────────────────────
-- 3. CS 문의 테이블
-- ──────────────────────────────────────
create table if not exists cs_tickets (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references orders(id) on delete set null,
  customer_name    text,
  customer_contact text,
  category         text,  -- shipping / refund / exchange / other
  message          text,
  ai_response      text,
  status           text default 'open',  -- open / in_progress / resolved
  assigned_to      text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists idx_cs_tickets_status     on cs_tickets(status);
create index if not exists idx_cs_tickets_created_at on cs_tickets(created_at desc);

create or replace trigger trg_cs_tickets_updated_at
  before update on cs_tickets
  for each row execute function update_updated_at();

-- ──────────────────────────────────────
-- 4. 알림 발송 로그
-- ──────────────────────────────────────
create table if not exists notification_logs (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders(id) on delete set null,
  type       text,     -- order_confirm / shipping_start / arrival
  channel    text,     -- kakao / sms / email
  recipient  text,
  content    text,
  success    boolean default false,
  sent_at    timestamptz default now()
);

create index if not exists idx_notification_logs_order_id on notification_logs(order_id);
create index if not exists idx_notification_logs_sent_at  on notification_logs(sent_at desc);

-- ──────────────────────────────────────
-- 5. 스크래핑 스케줄
-- ──────────────────────────────────────
create table if not exists scrape_jobs (
  id             uuid primary key default gen_random_uuid(),
  url            text not null,
  interval_hours int default 24,
  last_scraped   timestamptz,
  is_active      boolean default true,
  created_at     timestamptz default now()
);
