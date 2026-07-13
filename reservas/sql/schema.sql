-- 物件×サイトの iCal フィード
create table if not exists feeds (
  id            bigserial primary key,
  property_name text not null,
  area          text default '',
  platform      text not null check (platform in ('airbnb','booking')),
  ical_url      text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 同期で毎回入れ替える予約/ブロック
create table if not exists reservations (
  id            bigserial primary key,
  property_name text not null,
  area          text default '',
  platform      text not null,
  type          text not null,           -- 'booking' | 'block'（自動判定）
  check_in      date not null,
  check_out     date not null,
  nights        int not null,
  res_code      text,
  res_url       text,
  summary       text,
  synced_at     timestamptz not null default now()
);
create index if not exists idx_res_range on reservations (property_name, check_in, check_out);

-- 手動の訂正（例: Booking の手動ブロックを block に直す）。同期で消えない。
create table if not exists overrides (
  property_name text not null,
  check_in      date not null,
  check_out     date not null,
  type          text not null check (type in ('booking','block')),
  primary key (property_name, check_in, check_out)
);

-- 事前チェックイン情報の提出フラグ（未設定=未提出）。同期で消えない。
create table if not exists checkin_status (
  property_name text not null,
  check_in      date not null,
  check_out     date not null,
  submitted     boolean not null default true,
  primary key (property_name, check_in, check_out)
);
