-- SINAGLIKHA members area
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; it only creates what is missing and refreshes the policies.

-- ---------------------------------------------------------------------------
-- 1. People: one profile row per invited account
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'member' check (role in ('member', 'admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper checks. "security definer" lets the policies read profiles without
-- looping back into themselves.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

revoke all on function public.is_member() from public, anon;
revoke all on function public.is_admin()  from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin()  to authenticated;

-- Every new account (invited from the dashboard or the website) gets a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profiles for accounts that already exist (for example, yours).
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

-- Who can see and change profiles
drop policy if exists "profiles: read own"      on public.profiles;
drop policy if exists "profiles: admins read"   on public.profiles;
drop policy if exists "profiles: admins update" on public.profiles;

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: admins read"
  on public.profiles for select to authenticated
  using (public.is_admin());

create policy "profiles: admins update"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Files: one private bucket called "library"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do update set public = false;

drop policy if exists "library: members read"   on storage.objects;
drop policy if exists "library: admins add"     on storage.objects;
drop policy if exists "library: admins change"  on storage.objects;
drop policy if exists "library: admins delete"  on storage.objects;

-- Any active member can list, preview and download.
create policy "library: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'library' and public.is_member());

-- Only admins can upload, replace or delete.
create policy "library: admins add"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and public.is_admin());

create policy "library: admins change"
  on storage.objects for update to authenticated
  using (bucket_id = 'library' and public.is_admin())
  with check (bucket_id = 'library' and public.is_admin());

create policy "library: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'library' and public.is_admin());

-- ---------------------------------------------------------------------------
-- OPTIONAL: let every active member upload too (not only admins).
-- Uncomment the block below and run it if you want that.
-- ---------------------------------------------------------------------------
-- drop policy if exists "library: admins add" on storage.objects;
-- create policy "library: members add"
--   on storage.objects for insert to authenticated
--   with check (bucket_id = 'library' and public.is_member());

-- ---------------------------------------------------------------------------
-- AFTER your own account exists, make yourself the first admin:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- ---------------------------------------------------------------------------
