create table if not exists public.fc_malls (
  mall_id text primary key,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fc_release_queue (
  mall_id text not null references public.fc_malls(mall_id) on delete cascade,
  product_no bigint not null,
  memo text not null default '',
  created_at timestamptz not null default now(),
  primary key (mall_id, product_no)
);
alter table public.fc_malls enable row level security;
alter table public.fc_release_queue enable row level security;
revoke all on public.fc_malls from anon, authenticated;
revoke all on public.fc_release_queue from anon, authenticated;
