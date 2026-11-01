-- SINAGLIKHA HR 201 Files: accounts, roles and file access
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. It creates what is missing and refreshes every rule.
--
-- ROLES
--   Administrator    the system owner. Hidden from everyone else. Manages accounts and can
--                    also open, upload and delete files.
--   Senior manager   full access to the HR 201 files: view, download, upload, create folders
--                    and delete. Can invite and manage other Senior managers, and can never
--                    see or change an Administrator.
--
-- >>> BEFORE YOU RUN IT, change the owner email in the block marked "EDIT THIS" below.
-- >>> Edit it only in the Supabase SQL editor. Do not save your email back into GitHub.

-- ---------------------------------------------------------------------------
-- 1. People: one profile row per account
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'senior_manager' check (role in ('admin', 'senior_manager')),
  active      boolean not null default true,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Older installs: add the column that hides the owner account.
alter table public.profiles add column if not exists hidden boolean not null default false;

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. One-time conversion from the old Member/Admin roles.
--    Runs only if the old roles are still in place. Everyone except the owner becomes a
--    Senior manager; the owner becomes the hidden Administrator.
-- ---------------------------------------------------------------------------
do $$
declare
  owner_email constant text := 'YOUR-ADMIN-EMAIL@example.com';  -- EDIT THIS (the email you sign in with)
  old_roles   boolean;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
      and pg_get_constraintdef(oid) like '%member%'
  ) into old_roles;

  if old_roles then
    if not exists (select 1 from public.profiles where lower(email) = lower(owner_email)) then
      raise exception 'The owner email "%" was not found. Edit the email in this block and run it again. Nothing was changed.', owner_email;
    end if;

    alter table public.profiles drop constraint profiles_role_check;
    update public.profiles set role = 'senior_manager' where lower(coalesce(email, '')) <> lower(owner_email);
    update public.profiles set role = 'admin', hidden = true, active = true where lower(email) = lower(owner_email);
  end if;
end;
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'senior_manager'));
alter table public.profiles alter column role set default 'senior_manager';

-- ---------------------------------------------------------------------------
-- 3. Clear the old rules so they can be replaced
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read own"             on public.profiles;
drop policy if exists "profiles: admins read"          on public.profiles;
drop policy if exists "profiles: admins update"        on public.profiles;
drop policy if exists "profiles: senior managers read"   on public.profiles;
drop policy if exists "profiles: senior managers update" on public.profiles;

drop policy if exists "library: members read"     on storage.objects;
drop policy if exists "library: members add"      on storage.objects;
drop policy if exists "library: admins add"       on storage.objects;
drop policy if exists "library: admins change"    on storage.objects;
drop policy if exists "library: admins delete"    on storage.objects;
drop policy if exists "library: repository read"   on storage.objects;
drop policy if exists "library: repository add"    on storage.objects;
drop policy if exists "library: repository change" on storage.objects;
drop policy if exists "library: repository delete" on storage.objects;

-- ---------------------------------------------------------------------------
-- 4. Helper checks ("security definer" lets rules read profiles without looping)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create or replace function public.is_senior_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'senior_manager'
  );
$$;

-- Anyone who may use the HR 201 files: an active Administrator or Senior manager.
create or replace function public.can_use_repository()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin', 'senior_manager')
  );
$$;

drop function if exists public.is_member();

revoke all on function public.is_admin()            from public, anon;
revoke all on function public.is_senior_manager()   from public, anon;
revoke all on function public.can_use_repository()  from public, anon;
grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_senior_manager()   to authenticated;
grant execute on function public.can_use_repository()  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. New accounts. Only INVITED accounts start out active, and they start as Senior manager.
--    Someone who signs themselves up (if sign-ups were ever left on) stays inactive and sees
--    "This account isn't active". Accounts made with "Add user -> Create new user" aren't
--    invitations either; activate those from the Accounts tab.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.invited_at is not null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profiles for accounts that already exist but have none.
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

-- Extra guard, so the rules hold even if someone tries to edit a record directly:
-- an account's id, email, creation date and hidden flag can't be changed from the site,
-- and only an Administrator can change a role. (The SQL editor and the server functions
-- are not signed-in users, so they are not limited by this.)
create or replace function public.profiles_guard()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at
     or new.hidden is distinct from old.hidden then
    raise exception 'That part of an account cannot be changed here.';
  end if;
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an administrator can change a role.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_trigger on public.profiles;
create trigger profiles_guard_trigger
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- 6. Who can see and change accounts
--    - everyone sees their own record
--    - an Administrator sees every account except hidden ones (the owner is hidden)
--    - a Senior manager sees only other Senior managers (never an Administrator)
--    - changes: an Administrator can change any visible account except their own;
--      a Senior manager can only switch other Senior managers on or off
-- ---------------------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: admins read"
  on public.profiles for select to authenticated
  using (public.is_admin() and not hidden);

create policy "profiles: senior managers read"
  on public.profiles for select to authenticated
  using (public.is_senior_manager() and role = 'senior_manager' and not hidden);

create policy "profiles: admins update"
  on public.profiles for update to authenticated
  using (public.is_admin() and not hidden and id <> auth.uid())
  with check (not hidden);

create policy "profiles: senior managers update"
  on public.profiles for update to authenticated
  using (public.is_senior_manager() and role = 'senior_manager' and not hidden and id <> auth.uid())
  with check (role = 'senior_manager' and not hidden);

-- ---------------------------------------------------------------------------
-- 7. Files: one private bucket called "library"
--    Administrators and Senior managers can list, open, upload, replace and delete.
--    Nobody else can do anything.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do update set public = false;

create policy "library: repository read"
  on storage.objects for select to authenticated
  using (bucket_id = 'library' and public.can_use_repository());

create policy "library: repository add"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and public.can_use_repository());

create policy "library: repository change"
  on storage.objects for update to authenticated
  using (bucket_id = 'library' and public.can_use_repository())
  with check (bucket_id = 'library' and public.can_use_repository());

create policy "library: repository delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'library' and public.can_use_repository());

-- ---------------------------------------------------------------------------
-- NEW INSTALL only (no accounts yet, or you skipped the conversion above):
-- after your own account exists, make it the hidden Administrator.
-- Run this one line in the SQL editor, with your own email:
--   update public.profiles set role = 'admin', hidden = true, active = true where email = 'you@example.com';
-- ---------------------------------------------------------------------------
