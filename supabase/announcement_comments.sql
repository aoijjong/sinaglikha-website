-- Comments on announcements (the comment button under every announcement on the Employee Portal).
-- Only the server (service role) reads and writes this table; the browser never touches it.
-- A comment you delete is hidden, not erased, so the record stays.

create table if not exists public.announcement_comments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists announcement_comments_post on public.announcement_comments (announcement_id, created_at);
create index if not exists announcement_comments_who on public.announcement_comments (employee_id, created_at);

alter table public.announcement_comments enable row level security;
revoke all on public.announcement_comments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports and moderation
-- Employees report a comment through /api/employee-comments (server only). The people who moderate the
-- forum (Employee Engagement Senior Managers and the Administrator, public.can_moderate_forum()) can see
-- every comment, hide or delete it, and settle the reports, straight from the Announcements screen.
-- ---------------------------------------------------------------------------
create table if not exists public.announcement_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.announcement_comments (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  reason text not null default '' check (length(reason) <= 300),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists announcement_comment_reports_once on public.announcement_comment_reports (comment_id, employee_id);
create index if not exists announcement_comment_reports_open on public.announcement_comment_reports (resolved, created_at);
alter table public.announcement_comment_reports enable row level security;
revoke all on public.announcement_comment_reports from anon, authenticated;

grant select, delete on public.announcement_comments to authenticated;
grant update (hidden) on public.announcement_comments to authenticated;
grant select, delete on public.announcement_comment_reports to authenticated;
grant update (resolved) on public.announcement_comment_reports to authenticated;

drop policy if exists "announcement comments: moderators read"   on public.announcement_comments;
drop policy if exists "announcement comments: moderators change" on public.announcement_comments;
drop policy if exists "announcement comments: moderators delete" on public.announcement_comments;
drop policy if exists "comment reports: moderators read"   on public.announcement_comment_reports;
drop policy if exists "comment reports: moderators change" on public.announcement_comment_reports;
drop policy if exists "comment reports: moderators delete" on public.announcement_comment_reports;
create policy "announcement comments: moderators read"   on public.announcement_comments for select to authenticated using (public.can_moderate_forum());
create policy "announcement comments: moderators change" on public.announcement_comments for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "announcement comments: moderators delete" on public.announcement_comments for delete to authenticated using (public.can_moderate_forum());
create policy "comment reports: moderators read"   on public.announcement_comment_reports for select to authenticated using (public.can_moderate_forum());
create policy "comment reports: moderators change" on public.announcement_comment_reports for update to authenticated using (public.can_moderate_forum()) with check (public.can_moderate_forum());
create policy "comment reports: moderators delete" on public.announcement_comment_reports for delete to authenticated using (public.can_moderate_forum());
