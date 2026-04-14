-- One-off fix: signup returns 500 because handle_new_user() inserts into public.profiles
-- while RLS policies expect auth.uid() (null during the auth.users trigger).
-- Run this in Supabase → SQL if you already applied an older schema without row_security bypass.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
