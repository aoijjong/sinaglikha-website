-- SINAGLIKHA Restricted Records: individual compensation, evaluation results, disciplinary cases
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql and supabase/employees.sql to have been run first.
--
-- WHO CAN SEE AND UPLOAD
--   Compensation         see: Administrator, every Senior Manager, and each employee their OWN
--                        upload: Total Rewards Senior Managers, Administrator
--   Evaluation results   see: Administrator, Total Rewards Senior Managers
--                        upload: Total Rewards Senior Managers, Administrator
--                        (employees do not see these)
--   Disciplinary cases   see: Administrator, every Senior Manager
--                        upload: Legal Compliance Senior Managers, Administrator
--                        (employees do not see these)
-- Files sit in a private bucket called "restricted", apart from the Content Manager's files.
-- Employees reach their own compensation records only through the server functions in /api.
-- Opening, uploading and deleting are written to the activity log by the website.

-- ---------------------------------------------------------------------------
-- 1. The rules, as two small checks
-- ---------------------------------------------------------------------------
create or replace function public.can_view_restricted(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin'
        or (p.role = 'senior_manager' and (
              k in ('compensation', 'disciplinary')
              or (k = 'evaluation' and p.department = 'rewards')))));
$$;

create or replace function public.can_upload_restricted(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin'
        or (p.role = 'senior_manager' and (
              (k in ('compensation', 'evaluation') and p.department = 'rewards')
              or (k = 'disciplinary' and p.department = 'legal')))));
$$;

revoke all on function public.can_view_restricted(text)   from public, anon;
revoke all on function public.can_upload_restricted(text) from public, anon;
grant execute on function public.can_view_restricted(text)   to authenticated;
grant execute on function public.can_upload_restricted(text) to authenticated;

-- A short list of employees for the "which employee?" pickers. Managers get only the ID, name
-- and whether the person is active; the Directory itself stays with Staffing and Recruitment.
create or replace function public.employee_options()
returns table (id uuid, employee_no text, full_name text, active boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.employee_no, e.full_name, e.active
  from public.employees e
  where public.is_manager()
  order by e.employee_no;
$$;
revoke all on function public.employee_options() from public, anon;
grant execute on function public.employee_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The records
-- ---------------------------------------------------------------------------
create table if not exists public.restricted_records (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  kind        text not null check (kind in ('compensation', 'evaluation', 'disciplinary')),
  title       text not null check (length(btrim(title)) between 1 and 160),
  period      text check (period is null or length(period) <= 60),
  notes       text not null default '' check (length(notes) <= 2000),
  file_path   text not null,
  extra       jsonb not null default '{}'::jsonb,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists restricted_records_employee_idx on public.restricted_records (employee_id, kind);
alter table public.restricted_records enable row level security;

revoke all on public.restricted_records from anon, authenticated;
grant select on public.restricted_records to authenticated;
grant insert (employee_id, kind, title, period, notes, file_path, extra) on public.restricted_records to authenticated;
grant update (title, period, notes) on public.restricted_records to authenticated;
grant delete on public.restricted_records to authenticated;

drop policy if exists "records: read"   on public.restricted_records;
drop policy if exists "records: add"    on public.restricted_records;
drop policy if exists "records: change" on public.restricted_records;
drop policy if exists "records: delete" on public.restricted_records;

create policy "records: read"   on public.restricted_records for select to authenticated
  using (public.can_view_restricted(kind));
create policy "records: add"    on public.restricted_records for insert to authenticated
  with check (public.can_upload_restricted(kind));
create policy "records: change" on public.restricted_records for update to authenticated
  using (public.can_upload_restricted(kind)) with check (public.can_upload_restricted(kind));
create policy "records: delete" on public.restricted_records for delete to authenticated
  using (public.can_upload_restricted(kind));

-- ---------------------------------------------------------------------------
-- 3. The private bucket "restricted". A file's path starts with its kind
--    (compensation/..., evaluation/..., disciplinary/...), and that decides who may touch it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('restricted', 'restricted', false)
on conflict (id) do update set public = false;

drop policy if exists "restricted bucket: read"   on storage.objects;
drop policy if exists "restricted bucket: add"    on storage.objects;
drop policy if exists "restricted bucket: change" on storage.objects;
drop policy if exists "restricted bucket: delete" on storage.objects;

create policy "restricted bucket: read"   on storage.objects for select to authenticated
  using (bucket_id = 'restricted' and public.can_view_restricted(split_part(name, '/', 1)));
create policy "restricted bucket: add"    on storage.objects for insert to authenticated
  with check (bucket_id = 'restricted' and public.can_upload_restricted(split_part(name, '/', 1)));
create policy "restricted bucket: change" on storage.objects for update to authenticated
  using (bucket_id = 'restricted' and public.can_upload_restricted(split_part(name, '/', 1)))
  with check (bucket_id = 'restricted' and public.can_upload_restricted(split_part(name, '/', 1)));
create policy "restricted bucket: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'restricted' and public.can_upload_restricted(split_part(name, '/', 1)));
