-- SINAGLIKHA: employee profile photos for the Attendance Tracker
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- The photo column of public.employees is not readable from the browser (only the portal's server
-- reads it). This function hands the photos to the people who run the Attendance Tracker: the
-- Administrator and the Senior Manager of Staffing and Recruitment, the same people who can read
-- the Employees directory (can_manage_employees). Everyone else gets nothing back.
create or replace function public.employee_photos()
returns table (id uuid, avatar text)
language sql stable security definer set search_path = public as $$
  select e.id, e.avatar
  from public.employees e
  where public.can_manage_employees() and e.avatar is not null;
$$;
revoke all on function public.employee_photos() from public, anon;
grant execute on function public.employee_photos() to authenticated;
