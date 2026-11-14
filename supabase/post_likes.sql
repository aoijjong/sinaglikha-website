-- Likes on announcements and community threads (the heart on the Employee Portal).
-- One row per employee per post. Only the server (service role) reads and writes it; the browser never touches this table.
-- Already applied to the project; this file is the record of it.

create table if not exists public.post_likes (
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('announcement', 'thread')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, kind, item_id)
);
create index if not exists post_likes_item on public.post_likes (kind, item_id);

alter table public.post_likes enable row level security;
revoke all on public.post_likes from anon, authenticated;
