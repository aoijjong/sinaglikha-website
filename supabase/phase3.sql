-- SINAGLIKHA Phase 3: Learning Management System and Employee Forum
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql, employees.sql and content_manager.sql to have been run first.
--
-- LEARNING
--   Any active manager can build courses and modules (a module is a link or a file). A course is
--   invisible to employees until it is published. Employees open modules and mark them complete in
--   the Employee Portal, through /api/employee-learning. An employee sees only their own progress.
--   Managers can read the progress table, to show how many people finished each module.
--
-- FORUM
--   Employees post with their own name, through /api/employee-forum (never directly). There are no
--   private messages. Employee Engagement Senior Managers and the Administrator are the moderators:
--   they manage the categories and can hide, lock or delete threads and posts and settle reports.
--   Hidden threads and posts are never sent to employees.

-- ---------------------------------------------------------------------------
-- 1. Who moderates the forum
-- ---------------------------------------------------------------------------
create or replace function public.can_moderate_forum() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'engagement')));
$$;
revoke all on function public.can_moderate_forum() from public, anon;
grant execute on function public.can_moderate_forum() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Learning: courses, modules, and each employee's progress
-- ---------------------------------------------------------------------------
create table if not exists public.learning_courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  position    integer not null default 0,
  published   boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.learning_modules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.learning_courses (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  kind        text not null check (kind in ('link', 'file')),
  url         text check (url is null or (url ~ '^https?://[^ ]+$' and length(url) <= 1000)),
  file_path   text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  check ((kind = 'link' and url is not null) or (kind = 'file' and file_path is not null))
);
create index if not exists learning_modules_course_idx on public.learning_modules (course_id, position);

create table if not exists public.learning_progress (
  employee_id  uuid not null references public.employees (id) on delete cascade,
  module_id    uuid not null references public.learning_modules (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (employee_id, module_id)
);

alter table public.learning_courses  enable row level security;
alter table public.learning_modules  enable row level security;
alter table public.learning_progress enable row level security;

revoke all on public.learning_courses, public.learning_modules, public.learning_progress from anon, authenticated;
grant select, delete on public.learning_courses to authenticated;
grant insert (title, description, position, published) on public.learning_courses to authenticated;
grant update (title, description, position, published) on public.learning_courses to authenticated;
grant select, delete on public.learning_modules to authenticated;
grant insert (course_id, title, description, kind, url, file_path, position) on public.learning_modules to authenticated;
grant update (title, description, url, position) on public.learning_modules to authenticated;
grant select on public.learning_progress to authenticated;

drop policy if exists "learning courses: managers read"   on public.learning_courses;
drop policy if exists "learning courses: managers add"    on public.learning_courses;
drop policy if exists "learning courses: managers change" on public.learning_courses;
drop policy if exists "learning courses: managers delete" on public.learning_courses;
drop policy if exists "learning modules: managers read"   on public.learning_modules;
drop policy if exists "learning modules: managers add"    on public.learning_modules;
drop policy if exists "learning modules: managers change" on public.learning_modules;
drop policy if exists "learning modules: managers delete" on public.learning_modules;
drop policy if exists "learning progress: managers read"  on public.learning_progress;

create policy "learning courses: managers read"   on public.learning_courses for select to authenticated using (public.is_manager());
create policy "learning courses: managers add"    on public.learning_courses for insert to authenticated with check (public.is_manager());
create policy "learning courses: managers change" on public.learning_courses for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "learning courses: managers delete" on public.learning_courses for delete to authenticated using (public.is_manager());
create policy "learning modules: managers read"   on public.learning_modules for select to authenticated using (public.is_manager());
create policy "learning modules: managers add"    on public.learning_modules for insert to authenticated with check (public.is_manager());
create policy "learning modules: managers change" on public.learning_modules for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "learning modules: managers delete" on public.learning_modules for delete to authenticated using (public.is_manager());
create policy "learning progress: managers read"  on public.learning_progress for select to authenticated using (public.is_manager());

-- ---------------------------------------------------------------------------
-- 3. Forum: categories, threads, posts, reports
-- ---------------------------------------------------------------------------
create table if not exists public.forum_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.forum_threads (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.forum_categories (id) on delete cascade,
  employee_id  uuid not null references public.employees (id),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text not null check (length(btrim(body)) between 1 and 2000),
  locked       boolean not null default false,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);
create index if not exists forum_threads_cat_idx on public.forum_threads (category_id, last_post_at desc);

create table if not exists public.forum_posts (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.forum_threads (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists forum_posts_thread_idx on public.forum_posts (thread_id, created_at);

create table if not exists public.forum_reports (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid references public.forum_threads (id) on delete cascade,
  post_id     uuid references public.forum_posts (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  reason      text not null default '' check (length(reason) <= 300),
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  check (thread_id is not null or post_id is not null)
);

alter table public.forum_categories enable row level security;
alter table public.forum_threads    enable row level security;
alter table public.forum_posts      enable row level security;
alter table public.forum_reports    enable row level security;

revoke all on public.forum_categories, public.forum_threads, public.forum_posts, public.forum_reports from anon, authenticated;
grant select, delete on public.forum_categories to authenticated;
grant insert (name, description, position, active) on public.forum_categories to authenticated;
grant update (name, description, position, active) on public.forum_categories to authenticated;
grant select, delete on public.forum_threads to authenticated;
grant update (hidden, locked) on public.forum_threads to authenticated;
grant select, delete on public.forum_posts to authenticated;
grant update (hidden) on public.forum_posts to authenticated;
grant select, delete on public.forum_reports to authenticated;
grant update (resolved) on public.forum_reports to authenticated;

drop policy if exists "forum categories: moderators read"   on public.forum_categories;
drop policy if exists "forum categories: moderators add"    on public.forum_categories;
drop policy if exists "forum categories: moderators change" on public.forum_categories;
drop policy if exists "forum categories: moderators delete" on public.forum_categories;
drop policy if exists "forum threads: moderators read"      on public.forum_threads;
drop policy if exists "forum threads: moderators change"    on public.forum_threads;
drop policy if exists "forum threads: moderators delete"    on public.forum_threads;
drop policy if exists "forum posts: moderators read"        on public.forum_posts;
drop policy if exists "forum posts: moderators change"      on public.forum_posts;
drop policy if exists "forum posts: moderators delete"      on public.forum_posts;
drop policy if exists "forum reports: moderators read"      on public.forum_reports;
drop policy if exists "forum reports: moderators change"    on public.forum_reports;
drop policy if exists "forum reports: moderators delete"    on public.forum_reports;

create policy "forum categories: moderators read"   on public.forum_categories for select to authenticated using (public.can_moderate_forum());
create policy "forum categories: moderators add"    on public.forum_categories for insert to authenticated with check (public.can_moderate_forum());
create policy "forum categories: moderators change" on public.forum_categories for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "forum categories: moderators delete" on public.forum_categories for delete to authenticated using (public.can_moderate_forum());
create policy "forum threads: moderators read"      on public.forum_threads for select to authenticated using (public.can_moderate_forum());
create policy "forum threads: moderators change"    on public.forum_threads for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "forum threads: moderators delete"    on public.forum_threads for delete to authenticated using (public.can_moderate_forum());
create policy "forum posts: moderators read"        on public.forum_posts for select to authenticated using (public.can_moderate_forum());
create policy "forum posts: moderators change"      on public.forum_posts for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "forum posts: moderators delete"      on public.forum_posts for delete to authenticated using (public.can_moderate_forum());
create policy "forum reports: moderators read"      on public.forum_reports for select to authenticated using (public.can_moderate_forum());
create policy "forum reports: moderators change"    on public.forum_reports for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "forum reports: moderators delete"    on public.forum_reports for delete to authenticated using (public.can_moderate_forum());

-- A few starter categories the first time this runs (moderators can rename or remove them).
insert into public.forum_categories (name, description, position)
select v.name, v.description, v.position
from (values
  ('Ideas and Suggestions', 'Share ideas for making SINAGLIKHA better.', 1),
  ('Questions', 'Ask the team a question about work or HR.', 2),
  ('Community', 'Say hello, celebrate wins and share what you are up to.', 3)
) as v(name, description, position)
where not exists (select 1 from public.forum_categories);
