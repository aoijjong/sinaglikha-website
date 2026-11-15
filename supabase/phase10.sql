-- SINAGLIKHA Performance Management System, part 3: departments.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/phase5.sql, phase6.sql and restricted_records.sql to have been run first.
--
-- Every employee belongs to one department, and so does every Manager evaluation form:
--   * a Manager form is for one department. Only that department's Senior Managers (and the
--     Administrator) can evaluate with it, and only the employees of that department.
--   * a Peer evaluation is only for colleagues of the same department (the server checks this,
--     see api/employee-evaluate.js).
--   * Self and Peer forms may also be for one department, or left for every department.
-- Staffing and Recruitment (and the Administrator) set each employee's department in the Employee Directory.

-- ---------------------------------------------------------------------------
-- 1. Departments on employees and on forms
-- ---------------------------------------------------------------------------
alter table public.employees add column if not exists department text;
alter table public.employees drop constraint if exists employees_department_check;
alter table public.employees add constraint employees_department_check
  check (department is null or department in ('staffing', 'training', 'engagement', 'rewards', 'legal'));

alter table public.scorecards add column if not exists department text;
alter table public.scorecards drop constraint if exists scorecards_department_check;
alter table public.scorecards add constraint scorecards_department_check
  check (department is null or department in ('staffing', 'training', 'engagement', 'rewards', 'legal'));

-- the Directory may read and set the department (same people as before: Staffing and the Administrator)
grant select (id, employee_no, full_name, position, active, pin_set, code_expires_at, locked_until, last_login_at, created_at, department)
  on public.employees to authenticated;
grant insert (employee_no, full_name, position, department) on public.employees to authenticated;
grant update (full_name, position, active, department) on public.employees to authenticated;

-- the form builder may set a form's department
grant insert (title, description, scale_max, labels, criteria, active, category, period, opens_on, closes_on, department) on public.scorecards to authenticated;
grant update (title, description, scale_max, labels, criteria, active, category, period, opens_on, closes_on, department) on public.scorecards to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The short list of employees for the pickers now says each person's department and position
-- ---------------------------------------------------------------------------
drop function if exists public.employee_options();
create or replace function public.employee_options()
returns table (id uuid, employee_no text, full_name text, active boolean, department text, position text)
language sql stable security definer set search_path = public as $$
  select e.id, e.employee_no, e.full_name, e.active, e.department, e.position
  from public.employees e
  where public.is_manager()
  order by e.employee_no;
$$;
revoke all on function public.employee_options() from public, anon;
grant execute on function public.employee_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A Manager evaluation can only be started by a Senior Manager of the employee's department
-- ---------------------------------------------------------------------------
create or replace function public.evaluations_dept_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; emp_dept text;
begin
  -- Self and Peer evaluations come in through the server (no signed-in manager), which checks them itself
  if auth.uid() is null or new.scorecard_id is null then return new; end if;
  select s.category, s.department into f from public.scorecards s where s.id = new.scorecard_id;
  if f.category is distinct from 'manager' then return new; end if;
  if f.department is null then
    raise exception 'This form has no department yet. Ask Total Rewards to set one.';
  end if;
  select e.department into emp_dept from public.employees e where e.id = new.employee_id;
  if emp_dept is distinct from f.department then
    raise exception 'That employee is not in the department this form is for.';
  end if;
  if not public.is_admin() and public.my_department() is distinct from f.department then
    raise exception 'You can only evaluate employees of your own department.';
  end if;
  return new;
end;
$$;
revoke all on function public.evaluations_dept_guard() from public, anon, authenticated;

drop trigger if exists evaluations_dept_guard on public.evaluations;
create trigger evaluations_dept_guard before insert on public.evaluations
  for each row execute function public.evaluations_dept_guard();
