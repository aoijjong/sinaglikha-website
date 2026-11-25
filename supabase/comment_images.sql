-- Photos on Employee Forum replies and on announcement comments. Run this once in the Supabase SQL editor (safe to run again).
--
-- Employees attach up to 3 photos to a reply or a comment. As with discussion photos (forum_images.sql), the browser shrinks
-- each photo and saves it as a plain JPEG, then uploads it straight to the PRIVATE "forum-images" bucket under a random name, so
-- nothing in the path says who posted it. Employees see a photo through a short-lived link the site makes for them while the
-- reply or comment is visible; moderators see them in the Senior Manager portal.
--
-- A reply or comment may now be a photo on its own (no text): the text rule is relaxed (the site still requires text or a photo).
-- Until this has run, the "Add photo" button is simply not shown on replies and comments, and everything works as before.
--
-- Needs supabase/phase3.sql, supabase/announcement_comments.sql and supabase/forum_images.sql (for the bucket).

create table if not exists public.forum_post_images (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.forum_posts (id) on delete cascade,
  path       text not null unique,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3145728),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  confirmed  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists forum_post_images_post_idx on public.forum_post_images (post_id);

create table if not exists public.announcement_comment_images (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.announcement_comments (id) on delete cascade,
  path       text not null unique,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3145728),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  confirmed  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists announcement_comment_images_idx on public.announcement_comment_images (comment_id);

alter table public.forum_post_images enable row level security;
alter table public.announcement_comment_images enable row level security;
revoke all on public.forum_post_images, public.announcement_comment_images from anon, authenticated;
grant select on public.forum_post_images, public.announcement_comment_images to authenticated;

drop policy if exists "forum post images: moderators read" on public.forum_post_images;
create policy "forum post images: moderators read" on public.forum_post_images for select to authenticated
  using (public.can_moderate_forum());
drop policy if exists "comment images: moderators read" on public.announcement_comment_images;
create policy "comment images: moderators read" on public.announcement_comment_images for select to authenticated
  using (public.can_moderate_forum());

-- A reply or comment may have no text when it carries a photo: drop the old "1 to N characters" rules, keep an upper limit.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.forum_posts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%body%'
  loop
    execute format('alter table public.forum_posts drop constraint %I', c);
  end loop;
  for c in select conname from pg_constraint
           where conrelid = 'public.announcement_comments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%body%'
  loop
    execute format('alter table public.announcement_comments drop constraint %I', c);
  end loop;
end $$;
alter table public.forum_posts alter column body set default '';
alter table public.announcement_comments alter column body set default '';
alter table public.forum_posts add constraint forum_posts_body_len check (char_length(body) <= 2000);
alter table public.announcement_comments add constraint announcement_comments_body_len check (char_length(body) <= 1000);
