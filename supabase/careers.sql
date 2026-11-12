-- SINAGLIKHA Careers, part 1: the vacancy database and the public Careers page
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first.
--
-- Who can do what:
--   public visitors   read PUBLISHED vacancies only (inside their opening and closing dates), and only the
--                     columns listed in the grant below. Drafts, closed and archived vacancies are invisible.
--   recruiters        the Administrator and the Senior Manager of Staffing and Recruitment can see, add, change
--                     and delete every vacancy, and upload poster images.
--   everyone else     employees and other Senior Managers get no extra access.
-- Poster images live in the public "careers" bucket (they are public marketing material). Nothing about an
-- applicant is stored here; applications come in a later part.

create or replace function public.can_manage_recruitment()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'staffing')));
$$;
revoke all on function public.can_manage_recruitment() from public, anon;
grant execute on function public.can_manage_recruitment() to authenticated;

create table if not exists public.vacancies (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique,
  title            text not null check (length(btrim(title)) between 1 and 120),
  department       text not null check (department in ('staffing', 'training', 'engagement', 'rewards', 'legal')),
  summary          text not null default '' check (length(summary) <= 1000),
  responsibilities text not null default '' check (length(responsibilities) <= 4000),
  qualifications   text not null default '' check (length(qualifications) <= 4000),
  employment_type  text not null default '' check (length(employment_type) <= 60),
  location         text not null default '' check (length(location) <= 120),
  openings         integer check (openings is null or openings between 1 and 999),
  opens_on         date,
  closes_on        date,
  status           text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  poster_path      text not null default '' check (length(poster_path) <= 300),
  thumb_path       text not null default '' check (length(thumb_path) <= 300),
  sort_order       integer not null default 1000,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists vacancies_status_idx on public.vacancies (status, sort_order);
alter table public.vacancies enable row level security;

-- Keeps the dates sensible, gives every vacancy a slug, and stamps who made it and when.
create or replace function public.vacancies_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.opens_on is not null and new.closes_on is not null and new.closes_on < new.opens_on then
    raise exception 'The closing date is before the opening date.';
  end if;
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := regexp_replace(lower(new.title), '[^a-z0-9]+', '-', 'g') || '-' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.vacancies_stamp() from public, anon, authenticated;
drop trigger if exists vacancies_stamp_trigger on public.vacancies;
create trigger vacancies_stamp_trigger before insert or update on public.vacancies
  for each row execute function public.vacancies_stamp();

-- Rules
revoke all on public.vacancies from anon, authenticated;
grant select (id, slug, title, department, summary, employment_type, location, openings, opens_on, closes_on, poster_path, thumb_path, sort_order)
  on public.vacancies to anon;
grant select, insert, update, delete on public.vacancies to authenticated;

drop policy if exists "vacancies: public read" on public.vacancies;
create policy "vacancies: public read" on public.vacancies for select to anon, authenticated
  using (status = 'published'
         and (opens_on is null or opens_on <= (now() at time zone 'Asia/Manila')::date)
         and (closes_on is null or closes_on >= (now() at time zone 'Asia/Manila')::date));

drop policy if exists "vacancies: recruiters read"   on public.vacancies;
drop policy if exists "vacancies: recruiters add"    on public.vacancies;
drop policy if exists "vacancies: recruiters change" on public.vacancies;
drop policy if exists "vacancies: recruiters delete" on public.vacancies;
create policy "vacancies: recruiters read"   on public.vacancies for select to authenticated using (public.can_manage_recruitment());
create policy "vacancies: recruiters add"    on public.vacancies for insert to authenticated with check (public.can_manage_recruitment());
create policy "vacancies: recruiters change" on public.vacancies for update to authenticated using (public.can_manage_recruitment()) with check (public.can_manage_recruitment());
create policy "vacancies: recruiters delete" on public.vacancies for delete to authenticated using (public.can_manage_recruitment());

-- Poster images: a public bucket (anyone may view a poster, only recruiters may add, replace or delete one)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('careers', 'careers', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];

drop policy if exists "careers: recruiters add"    on storage.objects;
drop policy if exists "careers: recruiters change" on storage.objects;
drop policy if exists "careers: recruiters delete" on storage.objects;
create policy "careers: recruiters add"    on storage.objects for insert to authenticated with check (bucket_id = 'careers' and public.can_manage_recruitment());
create policy "careers: recruiters change" on storage.objects for update to authenticated using (bucket_id = 'careers' and public.can_manage_recruitment());
create policy "careers: recruiters delete" on storage.objects for delete to authenticated using (bucket_id = 'careers' and public.can_manage_recruitment());
