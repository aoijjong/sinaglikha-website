-- SINAGLIKHA Employee profile photos
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/employees.sql to have been run first.
--
-- Employees choose their own small square photo in the Employee Portal. It is kept on their
-- Directory row, but it is NOT in the column list managers can read (employees.sql grants those
-- one by one), so a photo only travels through the server functions in /api.

alter table public.employees add column if not exists avatar text;
alter table public.employees drop constraint if exists employees_avatar_check;
alter table public.employees add constraint employees_avatar_check
  check (avatar is null or (avatar like 'data:image/%' and length(avatar) <= 120000));
