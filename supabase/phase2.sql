-- SINAGLIKHA Phase 2: Attendance Tracker and Performance Management System (evaluation setup)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql and supabase/employees.sql to have been run first.
--
-- ATTENDANCE
--   Employees record their own time in and time out in the Employee Portal. That goes through the
--   server function /api/employee-attendance, which uses the Philippine clock (UTC+8), allows one
--   time in and one time out per day, and takes the employee from the sign-in cookie. Nobody signed
--   in as an employee can touch this table directly.
--   Staffing and Recruitment Senior Managers and the Administrator can read every record, correct
--   a time or a note, and add a record for a missed day. Nobody can delete a record from the site.
--
-- EVALUATIONS
--   Managers keep the links to the external evaluation forms (self, peer, manager) with
--   instructions and an optional open and close date. Employees see only the ones that are active
--   and open today, through /api/employee-content.

-- ---------------------------------------------------------------------------
-- 1. Who reviews attendance: the Administrator and Staffing and Recruitment Senior Managers
-- ---------------------------------------------------------------------------
create or replace function public.can_review_attendance() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'staffing')));
$$;
revoke all on function public.can_review_attendance() from public, anon;
grant execute on function public.can_review_attendance() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Attendance records: one row per employee per day
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  work_date    date not null,
  time_in      timestamptz,
  time_out     timestamptz,
  note         text not null default '' check (length(note) <= 500),
  corrected_by uuid,
  corrected_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (employee_id, work_date),
  check (time_out is null or time_in is null or time_out >= time_in)
);
create index if not exists attendance_date_idx on public.attendance_records (work_date, employee_id);
alter table public.attendance_records enable row level security;

-- Stamp who corrected a record whenever a signed-in manager changes it.
create or replace function public.attendance_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.corrected_by := auth.uid();
    new.corrected_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists attendance_stamp_trigger on public.attendance_records;
create trigger attendance_stamp_trigger before update on public.attendance_records
  for each row execute function public.attendance_stamp();

revoke all on public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;
grant insert (employee_id, work_date, time_in, time_out, note) on public.attendance_records to authenticated;
grant update (time_in, time_out, note) on public.attendance_records to authenticated;

drop policy if exists "attendance: reviewers read"   on public.attendance_records;
drop policy if exists "attendance: reviewers add"    on public.attendance_records;
drop policy if exists "attendance: reviewers change" on public.attendance_records;

create policy "attendance: reviewers read"   on public.attendance_records for select to authenticated
  using (public.can_review_attendance());
create policy "attendance: reviewers add"    on public.attendance_records for insert to authenticated
  with check (public.can_review_attendance());
create policy "attendance: reviewers change" on public.attendance_records for update to authenticated
  using (public.can_review_attendance()) with check (public.can_review_attendance());

-- ---------------------------------------------------------------------------
-- 3. Evaluation setups: links to the external forms
-- ---------------------------------------------------------------------------
create table if not exists public.evaluation_setups (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 160),
  kind         text not null check (kind in ('self', 'peer', 'manager')),
  url          text not null check (url ~ '^https?://[^ ]+$' and length(url) <= 1000),
  instructions text not null default '' check (length(instructions) <= 2000),
  opens_on     date,
  closes_on    date,
  active       boolean not null default false,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (closes_on is null or opens_on is null or closes_on >= opens_on)
);
alter table public.evaluation_setups enable row level security;

create or replace function public.evaluation_setups_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists evaluation_setups_touch_trigger on public.evaluation_setups;
create trigger evaluation_setups_touch_trigger before update on public.evaluation_setups
  for each row execute function public.evaluation_setups_touch();

revoke all on public.evaluation_setups from anon, authenticated;
grant select, delete on public.evaluation_setups to authenticated;
grant insert (title, kind, url, instructions, opens_on, closes_on, active) on public.evaluation_setups to authenticated;
grant update (title, kind, url, instructions, opens_on, closes_on, active) on public.evaluation_setups to authenticated;

drop policy if exists "evaluations: managers read"   on public.evaluation_setups;
drop policy if exists "evaluations: managers add"    on public.evaluation_setups;
drop policy if exists "evaluations: managers change" on public.evaluation_setups;
drop policy if exists "evaluations: managers delete" on public.evaluation_setups;

create policy "evaluations: managers read"   on public.evaluation_setups for select to authenticated
  using (public.is_manager());
create policy "evaluations: managers add"    on public.evaluation_setups for insert to authenticated
  with check (public.is_manager());
create policy "evaluations: managers change" on public.evaluation_setups for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "evaluations: managers delete" on public.evaluation_setups for delete to authenticated
  using (public.is_manager());
