-- SINAGLIKHA 201 Files: accounts, roles and file access
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. It creates what is missing and refreshes every rule.
--
-- ROLES
--   Administrator    the system owner. Hidden from everyone else. Manages accounts and can
--                    also open, upload and delete files.
--   Senior Manager   belongs to one HR department (set by the Administrator). Can invite and
--                    manage other Senior Managers, and can never see or change an Administrator.
--                    Senior Managers of Staffing and Recruitment and of Legal Compliance have
--                    full access to the 201 Files: view, download, upload, create folders and
--                    delete. Senior Managers of the other departments do not.
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

-- Department: which of the five HR departments a Senior Manager belongs to. Only an
-- Administrator can set it (see the guard in section 5). Empty = no department yet.
alter table public.profiles add column if not exists department text;
alter table public.profiles drop constraint if exists profiles_department_check;
alter table public.profiles add constraint profiles_department_check
  check (department is null or department in ('staffing', 'training', 'engagement', 'rewards', 'legal'));

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. One-time conversion from the old Member/Admin roles.
--    Runs only if the old roles are still in place. Everyone except the owner becomes a
--    Senior Manager; the owner becomes the hidden Administrator.
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

-- The signed-in person's department (empty if none, or if the account is not active).
create or replace function public.my_department()
returns text
language sql stable security definer set search_path = public
as $$
  select p.department from public.profiles p
  where p.id = auth.uid() and p.active;
$$;

-- Anyone who may use the 201 Files: an active Administrator, or an active Senior Manager of
-- Staffing and Recruitment or Legal Compliance. Senior Managers with no department, or in
-- another department, are kept out.
create or replace function public.can_use_repository()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department in ('staffing', 'legal')))
  );
$$;

drop function if exists public.is_member();

revoke all on function public.is_admin()            from public, anon;
revoke all on function public.is_senior_manager()   from public, anon;
revoke all on function public.can_use_repository()  from public, anon;
revoke all on function public.my_department()       from public, anon;
grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_senior_manager()   to authenticated;
grant execute on function public.can_use_repository()  to authenticated;
grant execute on function public.my_department()       to authenticated;

-- ---------------------------------------------------------------------------
-- 5. New accounts. Only INVITED accounts start out active, and they start as Senior Manager.
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
-- and only an Administrator can change a role or a department. (The SQL editor and the server functions
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
  if new.department is distinct from old.department and not public.is_admin() then
    raise exception 'Only an administrator can change a department.';
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
--    - a Senior Manager sees only other Senior Managers (never an Administrator)
--    - changes: an Administrator can change any visible account except their own;
--      a Senior Manager can only switch other Senior Managers on or off
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

-- Profile settings page: a signed-in person can set their own name and picture (and nothing
-- else about their account). The picture is a small square JPEG kept with the profile, so it
-- needs no extra storage setup.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar is null or (avatar like 'data:image/%' and length(avatar) <= 120000));

drop function if exists public.set_my_name(text);

create or replace function public.set_my_profile(
  new_name text,
  new_avatar text default null,
  change_avatar boolean default false
)
returns json
language sql security definer set search_path = public
as $$
  update public.profiles p
  set full_name = left(btrim(coalesce(new_name, '')), 80),
      avatar    = case when change_avatar then nullif(new_avatar, '') else p.avatar end
  where p.id = auth.uid() and p.active
  returning json_build_object('full_name', p.full_name, 'avatar', p.avatar);
$$;

revoke all on function public.set_my_profile(text, text, boolean) from public, anon;
grant execute on function public.set_my_profile(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Files: one private bucket called "library"
--    Administrators and Senior Managers can list, open, upload, replace and delete.
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
-- 8. Activity log: who did what, and when. Add-only: nobody can edit or delete a line from the
--    site. Lines are written by the website through log_action(), which fills in who is signed
--    in. An Administrator reads every line; a Senior Manager reads the lines of their own
--    department. (Files opened or changed straight through the Supabase dashboard or API are
--    not recorded here; only actions done on this website are.)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  actor            uuid,
  actor_email      text,
  actor_department text,
  action           text not null,
  target           text,
  detail           jsonb
);

alter table public.audit_log enable row level security;
revoke insert, update, delete on public.audit_log from anon, authenticated;

drop policy if exists "audit_log: admins read"     on public.audit_log;
drop policy if exists "audit_log: department read" on public.audit_log;

create policy "audit_log: admins read"
  on public.audit_log for select to authenticated
  using (public.is_admin());

create policy "audit_log: department read"
  on public.audit_log for select to authenticated
  using (public.is_senior_manager() and actor_department is not null and actor_department = public.my_department());

create or replace function public.log_action(action text, target text default null, detail jsonb default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  who record;
begin
  select p.id, p.email, p.department into who
  from public.profiles p
  where p.id = auth.uid() and p.active;
  if not found then
    return;
  end if;
  insert into public.audit_log (actor, actor_email, actor_department, action, target, detail)
  values (who.id, who.email, who.department, left(action, 60), left(target, 300), detail);
end;
$$;

revoke all on function public.log_action(text, text, jsonb) from public, anon;
grant execute on function public.log_action(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS: Senior Managers have no department yet, so until you set one the 201 Files
-- are closed to them (the Administrator keeps access). Sign in as the Administrator, open the
-- Accounts tab and pick each person's department. Or do it here, with their email:
--   update public.profiles set department = 'staffing' where email = 'someone@example.com';
-- (staffing, training, engagement, rewards or legal)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- NEW INSTALL only (no accounts yet, or you skipped the conversion above):
-- after your own account exists, make it the hidden Administrator.
-- Run this one line in the SQL editor, with your own email:
--   update public.profiles set role = 'admin', hidden = true, active = true where email = 'you@example.com';
-- ---------------------------------------------------------------------------
