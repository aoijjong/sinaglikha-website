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
