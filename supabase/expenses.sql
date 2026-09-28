-- 支出 (レシート) を 1 件 1 行で持つテーブル。
-- 以前は user_data.payload.data["YYYY-MM"]["YYYY-MM-DD"].expenses[] に入れていた。
-- Supabase の SQL Editor で 1 回だけ実行する。
create table public.expenses (
  id             text primary key,             -- "exp…" (以前の payload の id をそのまま使う)
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date           date not null,                -- どの日の支出か (日本時間の日付)
  time           text,                         -- "HH:MM" (日本時間)。無ければ null
  occurred_at    timestamptz,                  -- 購入日時
  store          text,
  total          integer,                      -- 円
  category       text check (category in ('食費','日用品','交通費','娯楽','その他')),
  items          text[] not null default '{}', -- 購入品
  source         text,                         -- 'receipt' など
  storage_bucket text,
  storage_path   text,                         -- レシート画像 (Storage の ritual-images)
  checked_at     timestamptz,                  -- 目視チェック
  discarded_at   timestamptz,                  -- レシート破棄
  note           text,                         -- 備忘
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index expenses_user_date on public.expenses (user_id, date);

-- 自分の行だけ読み書きできる
alter table public.expenses enable row level security;
create policy "own rows" on public.expenses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 追加 (2026-09-28): 電子マネー・交通系 IC などへのチャージかどうか (合計から除いて別に数える)
alter table public.expenses add column is_charge boolean not null default false;
