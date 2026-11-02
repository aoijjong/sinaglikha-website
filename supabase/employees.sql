-- SINAGLIKHA Employee Directory and the tables behind Employee ID + PIN sign-in
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first (it uses public.profiles).
--
-- Employees do not get website accounts. They sign in through the server functions in /api
-- (employee-login, employee-activate, ...) with an Employee ID and a 6-digit PIN they choose
-- themselves with a one-time activation code. Nothing secret is kept where a manager can read it.
--
--   employees          the Directory. Staffing and Recruitment Senior Managers and the
--                      Administrator can read it, add people, edit names and positions, and
--                      switch people on or off. Nobody can delete a row from the site.
--   employee_secrets   PIN hash, activation-code hash, wrong-try count. Only the server
--                      functions (secret key) can touch it; no one signed in can read it.
--   employee_attempts  wrong-guess log used to slow down guessing. Server functions only.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),
  employee_no     text not null unique check (employee_no ~ '^[A-Z]{3}-[0-9]{4}$'),
  full_name       text not null check (length(btrim(full_name)) between 1 and 120),
  position        text check (position is null or length(position) <= 120),
  active          boolean not null default true,
  pin_set         boolean not null default false,
  code_expires_at timestamptz,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists public.employee_secrets (
  employee_id     uuid primary key references public.employees (id) on delete cascade,
  pin_hash        text,
  code_hash       text,
  failed_attempts integer not null default 0,
  session_version integer not null default 1
);

create table if not exists public.employee_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ip_hash     text not null,
  employee_no text,
  ok          boolean not null
);
create index if not exists employee_attempts_ip_idx on public.employee_attempts (ip_hash, at);

alter table public.employees          enable row level security;
alter table public.employee_secrets   enable row level security;
alter table public.employee_attempts  enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who manages the Directory: the Administrator and Staffing and Recruitment Senior Managers
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_employees() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'staffing')));
$$;
revoke all on function public.can_manage_employees() from public, anon;
grant execute on function public.can_manage_employees() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What those managers may do with the Directory (column by column)
-- ---------------------------------------------------------------------------
revoke all on public.employees from anon, authenticated;
grant select (id, employee_no, full_name, position, active, pin_set, code_expires_at, locked_until, last_login_at, created_at)
  on public.employees to authenticated;
grant insert (employee_no, full_name, position) on public.employees to authenticated;
grant update (full_name, position, active) on public.employees to authenticated;

drop policy if exists "employees: directory read"   on public.employees;
drop policy if exists "employees: directory add"    on public.employees;
drop policy if exists "employees: directory change" on public.employees;

create policy "employees: directory read"   on public.employees for select to authenticated
  using (public.can_manage_employees());
create policy "employees: directory add"    on public.employees for insert to authenticated
  with check (public.can_manage_employees());
create policy "employees: directory change" on public.employees for update to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());

-- ---------------------------------------------------------------------------
-- 4. Secrets and the guess log: closed to everyone signed in
-- ---------------------------------------------------------------------------
revoke all on public.employee_secrets  from anon, authenticated;
revoke all on public.employee_attempts from anon, authenticated;
