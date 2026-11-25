-- Photos on Employee Forum discussions. Run this once in the Supabase SQL editor (safe to run again).
--
-- Employees attach up to 4 photos to a new discussion. The browser shrinks each photo and saves it as a plain JPEG
-- (which also drops the hidden camera details such as the location), then uploads it straight to a PRIVATE bucket.
-- The file is stored under a random name inside the discussion's folder, so nothing in the path says who posted it,
-- and an anonymous discussion keeps its photos anonymous. Employees see a photo only through a short-lived link
-- that the site creates for them while the discussion is visible; moderators see them in the Senior Manager portal.
--
-- Needs supabase/phase3.sql (the forum tables and can_moderate_forum()).

create table if not exists public.forum_images (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.forum_threads (id) on delete cascade,
  path       text not null unique,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3145728),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  confirmed  boolean not null default false,     -- true once the file has really arrived in storage
  created_at timestamptz not null default now()
);
create index if not exists forum_images_thread_idx on public.forum_images (thread_id);

alter table public.forum_images enable row level security;
revoke all on public.forum_images from anon, authenticated;
grant select on public.forum_images to authenticated;

drop policy if exists "forum images: moderators read" on public.forum_images;
create policy "forum images: moderators read" on public.forum_images for select to authenticated
  using (public.can_moderate_forum());

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage is not available here: the forum-images bucket was not created.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('forum-images', 'forum-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "forum images: moderators read" on storage.objects;
  create policy "forum images: moderators read" on storage.objects for select to authenticated
    using (bucket_id = 'forum-images' and public.can_moderate_forum());
  drop policy if exists "forum images: moderators remove" on storage.objects;
  create policy "forum images: moderators remove" on storage.objects for delete to authenticated
    using (bucket_id = 'forum-images' and public.can_moderate_forum());
end $$;
