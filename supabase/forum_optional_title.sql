-- Makes the title of an Employee Forum discussion optional. Run this once in the Supabase SQL editor (safe to run again).
--
-- A discussion may now have no title: the forum then shows just the message. Until this has run the database still
-- insists on a title, so the site fills one in from the first words of the message and posting keeps working.
-- Needs supabase/phase3.sql.

do $$
declare c text;
begin
  -- the old rule ("a title of 1 to 120 characters"): find it by what it checks, whatever it was named
  for c in select conname from pg_constraint
           where conrelid = 'public.forum_threads'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%title%'
  loop
    execute format('alter table public.forum_threads drop constraint %I', c);
  end loop;
end $$;

alter table public.forum_threads alter column title set default '';
alter table public.forum_threads drop constraint if exists forum_threads_title_len;
alter table public.forum_threads add constraint forum_threads_title_len check (char_length(title) <= 120);
