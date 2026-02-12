-- Widget layouts: one layout per user, stored as JSONB
create table if not exists public.widget_layouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.widget_layouts enable row level security;

create policy "Users can view own layout"
  on public.widget_layouts for select
  using (auth.uid() = user_id);

create policy "Users can insert own layout"
  on public.widget_layouts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own layout"
  on public.widget_layouts for update
  using (auth.uid() = user_id);
