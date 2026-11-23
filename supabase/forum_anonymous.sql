-- Optional anonymous posting in the Community forum.
-- Safe to run more than once. Run it in the Supabase SQL editor.
--
-- employee_id stays on every row, so moderators can still see who wrote an anonymous post, the author can
-- still delete their own post, and the flood limits still work. "Anonymous" only hides the name and photo
-- from other employees: the API never sends employee_id to the portal, and for an anonymous row it sends
-- "Anonymous" and no photo.
--
-- Deploy order does not matter: until this has run, the site works exactly as before, and a request to post
-- anonymously is refused with a clear message (it is never posted under the person's name instead).

alter table public.forum_threads add column if not exists anonymous boolean not null default false;
alter table public.forum_posts   add column if not exists anonymous boolean not null default false;

comment on column public.forum_threads.anonymous is 'Hide the author''s name and photo from other employees. Moderators still see employee_id.';
comment on column public.forum_posts.anonymous   is 'Hide the author''s name and photo from other employees. Moderators still see employee_id.';
