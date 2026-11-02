-- SINAGLIKHA Content Manager: deliverables, content items and the private "content" bucket
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first (it uses public.profiles).
--
-- Any active Administrator or Senior Manager can read, add, change and delete content in every
-- deliverable. The 201 Files are not part of this; they keep their own rules in schema.sql.
-- Employees get nothing from here; they will read published items through server functions.

-- ---------------------------------------------------------------------------
-- 1. The 17 deliverables outside the 201 Files, and the department that owns each
-- ---------------------------------------------------------------------------
create table if not exists public.deliverables (
  key          text primary key,
  name         text not null,
  department   text not null check (department in ('staffing','training','engagement','rewards','legal')),
  kind         text not null check (kind in ('document','program','module','evaluation','special')),
  allow_public boolean not null default false
);
alter table public.deliverables enable row level security;

insert into public.deliverables (key, name, department, kind, allow_public) values
  ('company_files',        'Company Files',                     'staffing',   'document',   true),
  ('talent_flow',          'Talent Management Flow',            'staffing',   'document',   false),
  ('attendance',           'Attendance Tracker',                'staffing',   'special',    false),
  ('training_materials',   'Training Materials',                'training',   'document',   false),
  ('lms',                  'Learning Management System',        'training',   'module',     false),
  ('career_dev',           'Career Development Program',        'training',   'program',    false),
  ('communication',        'Communication Materials',           'engagement', 'document',   false),
  ('forum',                'Employee Forum',                    'engagement', 'special',    false),
  ('daily_activity',       'Daily Engagement Activity',         'engagement', 'program',    false),
  ('csr',                  'Engagement Activity - CSR',         'engagement', 'program',    true),
  ('wellness',             'Wellness Program',                  'engagement', 'program',    false),
  ('comp_packages',        'Compensation Packages',             'rewards',    'document',   false),
  ('pms',                  'Performance Management System',     'rewards',    'evaluation', false),
  ('incentive_plan',       'Incentive Plan Design',             'rewards',    'document',   false),
  ('handbook',             'Employee Handbook',                 'legal',      'document',   false),
  ('disciplinary_guidelines','Guidelines for Disciplinary Action','legal',    'document',   false),
  ('risk_plan',            'Risk Mitigation Plan',              'legal',      'document',   false)
on conflict (key) do update set name = excluded.name, department = excluded.department,
  kind = excluded.kind, allow_public = excluded.allow_public;

drop policy if exists "deliverables: signed-in read" on public.deliverables;
create policy "deliverables: signed-in read" on public.deliverables
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Manager check: any active Administrator or Senior Manager
-- ---------------------------------------------------------------------------
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin','senior_manager'));
$$;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The content itself: files, folders and links, each with a status and an audience
-- ---------------------------------------------------------------------------
create table if not exists public.content_items (
  id           uuid primary key default gen_random_uuid(),
  deliverable  text not null references public.deliverables (key),
  kind         text not null default 'file' check (kind in ('file','folder','link')),
  folder_path  text not null default '',
  title        text not null,
  description  text not null default '',
  category     text,
  file_path    text,
  external_url text,
  version      text,
  extra        jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','published','unpublished','archived')),
  audience     text not null default 'managers' check (audience in ('managers','employees','public')),
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists content_items_deliverable_idx on public.content_items (deliverable, folder_path);
alter table public.content_items enable row level security;

create or replace function public.content_items_guard() returns trigger
language plpgsql set search_path = public as $$
declare d public.deliverables;
begin
  select * into d from public.deliverables where key = new.deliverable;
  if d.kind = 'special' then
    raise exception 'This deliverable has its own screen.';
  end if;
  if new.audience = 'public' and not d.allow_public then
    raise exception 'This deliverable cannot be made public.';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  else
    new.uploaded_by := old.uploaded_by;
    new.created_at  := old.created_at;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists content_items_guard_trigger on public.content_items;
create trigger content_items_guard_trigger before insert or update on public.content_items
  for each row execute function public.content_items_guard();

-- ---------------------------------------------------------------------------
-- 4. Who can do what with content_items
--    Managers do everything (deleting only drafts, unpublished and archived items).
--    Anyone, signed in or not, can read an item only while it is Published and Public.
-- ---------------------------------------------------------------------------
revoke all on public.content_items from anon, authenticated;
grant select on public.content_items to anon;
grant select, insert, update, delete on public.content_items to authenticated;

drop policy if exists "content: managers read"   on public.content_items;
drop policy if exists "content: managers add"    on public.content_items;
drop policy if exists "content: managers change" on public.content_items;
drop policy if exists "content: managers delete" on public.content_items;
drop policy if exists "content: public read"     on public.content_items;

create policy "content: managers read"   on public.content_items for select to authenticated
  using (public.is_manager());
create policy "content: managers add"    on public.content_items for insert to authenticated
  with check (public.is_manager());
create policy "content: managers change" on public.content_items for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "content: managers delete" on public.content_items for delete to authenticated
  using (public.is_manager() and status in ('draft','unpublished','archived'));
create policy "content: public read"     on public.content_items for select to anon, authenticated
  using (status = 'published' and audience = 'public');

-- ---------------------------------------------------------------------------
-- 5. One private bucket "content". Managers do everything. Anyone can open a file only
--    while its item is Published and Public, so Unpublish closes it again at once.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('content', 'content', false)
on conflict (id) do update set public = false;

drop policy if exists "content bucket: managers read"   on storage.objects;
drop policy if exists "content bucket: managers add"    on storage.objects;
drop policy if exists "content bucket: managers change" on storage.objects;
drop policy if exists "content bucket: managers delete" on storage.objects;
drop policy if exists "content bucket: public read"     on storage.objects;

create policy "content bucket: managers read"   on storage.objects for select to authenticated
  using (bucket_id = 'content' and public.is_manager());
create policy "content bucket: managers add"    on storage.objects for insert to authenticated
  with check (bucket_id = 'content' and public.is_manager());
create policy "content bucket: managers change" on storage.objects for update to authenticated
  using (bucket_id = 'content' and public.is_manager())
  with check (bucket_id = 'content' and public.is_manager());
create policy "content bucket: managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'content' and public.is_manager());
create policy "content bucket: public read"     on storage.objects for select to anon, authenticated
  using (bucket_id = 'content' and exists (
    select 1 from public.content_items ci
    where ci.file_path = storage.objects.name and ci.status = 'published' and ci.audience = 'public'));
