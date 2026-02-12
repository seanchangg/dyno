-- Agent screenshots: stored in Supabase Storage with metadata in this table
create table if not exists public.agent_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  size integer not null default 0,
  created_at timestamptz not null default now()
);

-- Index for fast lookups by user
create index idx_screenshots_user on public.agent_screenshots (user_id, created_at desc);

alter table public.agent_screenshots enable row level security;

create policy "Users can view own screenshots"
  on public.agent_screenshots for select
  using (auth.uid() = user_id);

create policy "Users can insert own screenshots"
  on public.agent_screenshots for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own screenshots"
  on public.agent_screenshots for delete
  using (auth.uid() = user_id);

-- Create Supabase Storage bucket for screenshots (public for serving images)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

-- Storage policies: users can upload/delete their own screenshots
create policy "Users can upload screenshots"
  on storage.objects for insert
  with check (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own screenshots"
  on storage.objects for delete
  using (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

-- Public read access for screenshots bucket
create policy "Public read access for screenshots"
  on storage.objects for select
  using (bucket_id = 'screenshots');
