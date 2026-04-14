-- DrushtiAI — canonical Supabase schema (shared with Android app)
-- Run in Supabase → SQL Editor. Safe to re-run: RLS policies are dropped before recreate.
--
-- Replaces the previous AntiCheat-only schema (cameras/exam_sessions/incidents).
-- FastAPI keeps cameras and incidents in memory; shared persistence is profiles, exams, cheating_snapshots.

-- ==================== Core tables (matches FYP App / supabase_schema.sql) ====================

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  updated_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject text not null,
  exam_date date not null,
  exam_time text not null,
  student_count int not null default 0,
  room_notes text,
  status text not null default 'draft',
  camera_connected boolean not null default false,
  linked_device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cheating_snapshots (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams on delete cascade,
  image_url text not null,
  label text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.exams enable row level security;
alter table public.cheating_snapshots enable row level security;

-- Idempotent RLS: safe to re-run after a partial run or FYP App schema.sql
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;

drop policy if exists "exams_select_own" on public.exams;
drop policy if exists "exams_insert_own" on public.exams;
drop policy if exists "exams_update_own" on public.exams;
drop policy if exists "exams_delete_own" on public.exams;

drop policy if exists "snapshots_select_own" on public.cheating_snapshots;
drop policy if exists "snapshots_insert_own" on public.cheating_snapshots;
drop policy if exists "snapshots_delete_own" on public.cheating_snapshots;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

create policy "exams_select_own" on public.exams for select using (auth.uid() = user_id);
create policy "exams_insert_own" on public.exams for insert with check (auth.uid() = user_id);
create policy "exams_update_own" on public.exams for update using (auth.uid() = user_id);
create policy "exams_delete_own" on public.exams for delete using (auth.uid() = user_id);

create policy "snapshots_select_own" on public.cheating_snapshots for select using (
  exists (select 1 from public.exams e where e.id = exam_id and e.user_id = auth.uid())
);
create policy "snapshots_insert_own" on public.cheating_snapshots for insert with check (
  exists (select 1 from public.exams e where e.id = exam_id and e.user_id = auth.uid())
);
create policy "snapshots_delete_own" on public.cheating_snapshots for delete using (
  exists (select 1 from public.exams e where e.id = exam_id and e.user_id = auth.uid())
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- RLS policies use auth.uid(); inside this trigger there is no JWT session, so inserts can fail
  -- with 500 on signup unless row security is disabled for this SECURITY DEFINER function body.
  perform set_config('row_security', 'off', true);
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '')
  )
  on conflict (id) do update set
    full_name = coalesce(
      nullif(trim(full_name), ''),
      excluded.full_name
    ),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create index if not exists exams_user_id_created_at_idx on public.exams (user_id, created_at desc);
create index if not exists cheating_snapshots_exam_id_idx on public.cheating_snapshots (exam_id, created_at desc);

-- ==================== Public storage for snapshot URLs (Android Glide / HTTPS) ====================

insert into storage.buckets (id, name, public)
values ('cheating-snapshots', 'cheating-snapshots', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public read cheating-snapshots" on storage.objects;
create policy "Public read cheating-snapshots"
  on storage.objects for select
  using (bucket_id = 'cheating-snapshots');

drop policy if exists "Service role upload cheating-snapshots" on storage.objects;
create policy "Service role upload cheating-snapshots"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'cheating-snapshots');

drop policy if exists "Service role update cheating-snapshots" on storage.objects;
create policy "Service role update cheating-snapshots"
  on storage.objects for update
  to service_role
  using (bucket_id = 'cheating-snapshots');
