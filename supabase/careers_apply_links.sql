-- SINAGLIKHA Careers: the application link behind every "Apply now" button
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/careers.sql and supabase/recruitment.sql to have been run first.
--
-- Sets the SINAGLIKHA JOB APPLICATION FORM link on every vacancy that does not have an application link yet
-- (a vacancy that already has one, for example set by hand in the Vacancies screen, is left alone).
-- To give one position a different form later, edit that vacancy in the Vacancies screen and change its
-- "Apply Now link".
update public.vacancies
   set apply_url = 'https://forms.gle/HU2HsyfnXjBfZuNu7'
 where apply_url = '';

-- Check: how many vacancies now have a link
-- select count(*) filter (where apply_url <> '') as with_link, count(*) as total from public.vacancies;
