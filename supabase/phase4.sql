-- SINAGLIKHA Announcements: posts written by Senior Managers, with optional attached files
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql and supabase/content_manager.sql to have been run first.
--
-- Any active Senior Manager or the Administrator can write, edit, hide and delete announcements.
-- Each post shows who wrote it: the name and department are stamped by the database from the
-- signed-in account, so a post can never be made to look like it came from someone else.
-- Employees read published announcements through /api/employee-content (never directly).
-- Attached files live in the private "content" bucket under announcements/ and open for employees
-- through short-lived links made by the server.

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '' check (length(title) <= 160),
  body        text not null check (length(btrim(body)) between 1 and 5000),
  files       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10),
  published   boolean not null default true,
  author_id   uuid,
  author_name text not null default '',
  author_dept text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
alter table public.announcements enable row level security;

-- Stamp the author from the signed-in account; keep the author fixed on edits.
create or replace function public.announcements_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    select pr.full_name, pr.email, pr.department into p from public.profiles pr where pr.id = auth.uid();
    new.author_id   := auth.uid();
    new.author_name := coalesce(nullif(btrim(p.full_name), ''), p.email, 'A Senior Manager');
    new.author_dept := p.department;
    new.created_at  := now();
  else
    new.author_id   := old.author_id;
    new.author_name := old.author_name;
    new.author_dept := old.author_dept;
    new.created_at  := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists announcements_stamp_trigger on public.announcements;
create trigger announcements_stamp_trigger before insert or update on public.announcements
  for each row execute function public.announcements_stamp();

revoke all on public.announcements from anon, authenticated;
grant select, delete on public.announcements to authenticated;
grant insert (title, body, files, published) on public.announcements to authenticated;
grant update (title, body, files, published) on public.announcements to authenticated;

drop policy if exists "announcements: managers read"   on public.announcements;
drop policy if exists "announcements: managers add"    on public.announcements;
drop policy if exists "announcements: managers change" on public.announcements;
drop policy if exists "announcements: managers delete" on public.announcements;

create policy "announcements: managers read"   on public.announcements for select to authenticated using (public.is_manager());
create policy "announcements: managers add"    on public.announcements for insert to authenticated with check (public.is_manager());
create policy "announcements: managers change" on public.announcements for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "announcements: managers delete" on public.announcements for delete to authenticated using (public.is_manager());
