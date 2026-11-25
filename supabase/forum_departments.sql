-- General and department-only spaces in the Employee Forum. Run this once in the Supabase SQL editor (safe to run again).
--
-- Each forum category is either "general" (every employee sees it) or "departmental" (only employees of the same
-- department see it). A post in a departmental category is stamped with the poster's department by the site, from the
-- employee record, never from anything the browser sends; its replies, likes, photos and reports follow the same rule.
-- Moderators (Administrator and the Engagement team) still see every department in the Senior Manager portal.
--
-- Every category you already have stays "general", so nothing changes until you mark a category as departmental
-- (Senior Manager portal > Forum > Categories). Needs supabase/phase3.sql.

alter table public.forum_categories
  add column if not exists scope text not null default 'general';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'forum_categories_scope_check') then
    alter table public.forum_categories add constraint forum_categories_scope_check check (scope in ('general', 'departmental'));
  end if;
end $$;

alter table public.forum_threads
  add column if not exists department text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'forum_threads_department_check') then
    alter table public.forum_threads add constraint forum_threads_department_check
      check (department is null or department in ('staffing', 'training', 'engagement', 'rewards', 'legal'));
  end if;
end $$;
create index if not exists forum_threads_dept_idx on public.forum_threads (department) where department is not null;

-- A last line of defence behind the site: a discussion in a departmental category must carry a department, and one in
-- a general category must not (so a general post can never be hidden by mistake, nor a departmental one shown to all).
create or replace function public.forum_thread_scope_guard() returns trigger
language plpgsql as $$
declare s text;
begin
  select scope into s from public.forum_categories where id = new.category_id;
  if s = 'departmental' and new.department is null then
    raise exception 'A discussion in a departmental category needs a department.' using errcode = '23514';
  end if;
  if coalesce(s, 'general') = 'general' and new.department is not null then
    raise exception 'A discussion in a general category cannot have a department.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists forum_thread_scope_guard on public.forum_threads;
create trigger forum_thread_scope_guard before insert on public.forum_threads
  for each row execute function public.forum_thread_scope_guard();

-- A category's scope can only be changed while it has no discussions: flipping it afterwards would hide old posts from
-- everyone or show a department's posts to all.
create or replace function public.forum_category_scope_lock() returns trigger
language plpgsql as $$
begin
  if new.scope is distinct from old.scope and exists (select 1 from public.forum_threads where category_id = old.id) then
    raise exception 'This category already has discussions, so its scope cannot be changed.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists forum_category_scope_lock on public.forum_categories;
create trigger forum_category_scope_lock before update on public.forum_categories
  for each row execute function public.forum_category_scope_lock();
