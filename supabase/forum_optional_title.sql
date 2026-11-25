-- Makes the title AND the message of an Employee Forum discussion optional. Run this once in the Supabase SQL editor
-- (safe to run again).
--
-- A discussion may now have no title, no message, or neither (a photo-only post): the forum shows whatever it has. The site
-- itself makes sure a discussion still has at least a title, a message or a photo. Until this has run the database insists
-- on both a title and a message, so the site fills the gaps from what was written (or "Photo") and posting keeps working.
-- Needs supabase/phase3.sql.

do $$
declare c text;
begin
  -- the old rules ("a title of 1 to 120 characters", "a message of 1 to 2000"): found by what they check, whatever they were named
  for c in select conname from pg_constraint
           where conrelid = 'public.forum_threads'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) ilike '%title%' or pg_get_constraintdef(oid) ilike '%body%')
  loop
    execute format('alter table public.forum_threads drop constraint %I', c);
  end loop;
end $$;

alter table public.forum_threads alter column title set default '';
alter table public.forum_threads alter column body  set default '';
alter table public.forum_threads add constraint forum_threads_title_len check (char_length(title) <= 120);
alter table public.forum_threads add constraint forum_threads_body_len  check (char_length(body)  <= 2000);
