-- SINAGLIKHA Grievances (Legal Compliance). Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql, supabase/employees.sql, supabase/content_manager.sql and the department column on
-- profiles (phase2 or later) to have been run first.
--
-- WHO CAN SEE WHAT
--   Employees   raise grievances and follow their OWN through the website's server functions (never straight from
--               the browser). A grievance is either
--                 confidential  the employee is recorded, and only Legal Compliance can reveal who (and every reveal is logged)
--                 anonymous     NO employee is recorded at all. The employee gets a ticket number and a secret access
--                               code, and needs both to follow the case. Times on anonymous cases are rounded to the day.
--   Handlers    Legal Compliance Senior Managers and the Administrator. Every other Senior Manager sees nothing.
--               Routing keeps conflicts of interest out: a grievance that involves a member of the Legal Compliance team goes
--               to the Administrator only; one that involves the Administrator goes to Legal Compliance only. A handler can
--               also step away from a single case ("recuse"), after which it disappears for them.
--   Handlers never read the tables directly. They use the functions below, which check the rule, hide the
--   complainant's identity until "reveal", and write the activity log.
-- Ticket numbers look like GRV-2026-0001: a counter that restarts each year, handed out by the database.
-- Time limits (set by the Administrator, see grievance_settings): acknowledge, keep updating, and a resolution target.
-- Retention: the Administrator sets how many months a CLOSED case is kept; nothing is ever deleted until they do, and then
-- only when they press "Delete expired cases".
-- Files: a private bucket "grievances". Employees add files through the website's server; handlers open them with short links.
-- Deleting: any handler who may see a case can delete it for good (confirmed, logged by ticket number only).

-- ---------------------------------------------------------------------------
-- 1. The rules: who handles grievances, and who may see ONE grievance
-- ---------------------------------------------------------------------------
create or replace function public.can_handle_grievances() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'legal')));
$$;

create or replace function public.grievance_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- 2. The tables
-- ---------------------------------------------------------------------------
create table if not exists public.grievance_counter (
  year integer primary key,
  last integer not null default 0
);

create table if not exists public.grievances (
  id              uuid primary key default gen_random_uuid(),
  ticket_no       text unique,
  category        text not null check (category in ('harassment','discrimination','pay_benefits','safety','supervisor','policy','other')),
  subject         text not null check (length(btrim(subject)) between 1 and 120),
  body            text not null check (length(btrim(body)) between 1 and 4000),
  incident_date   date,
  location        text not null default '' check (length(location) <= 120),
  involved        text not null default '' check (length(involved) <= 300),
  confidentiality text not null check (confidentiality in ('confidential', 'anonymous')),
  employee_id     uuid references public.employees (id),
  code_hash       text,
  status          text not null default 'submitted' check (status in ('submitted','acknowledged','under_review','resolved','escalated','closed')),
  assigned_to     uuid references public.profiles (id) on delete set null,
  outcome         text not null default '' check (length(outcome) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  closed_at       timestamptz,
  -- an anonymous grievance stores NO employee and has an access code; a confidential one has the employee and no code
  constraint grievances_identity_check check ((confidentiality = 'anonymous') = (employee_id is null)),
  constraint grievances_code_check     check ((confidentiality = 'anonymous') = (code_hash is not null))
);
-- who may handle it: legal = Legal Compliance and the Administrator; admin_only = the case involves a Legal Compliance manager;
-- legal_only = the case involves the Administrator
alter table public.grievances add column if not exists routing text not null default 'legal';
alter table public.grievances drop constraint if exists grievances_routing_check;
alter table public.grievances add constraint grievances_routing_check check (routing in ('legal', 'admin_only', 'legal_only'));
create index if not exists grievances_employee_idx on public.grievances (employee_id, created_at desc);
create index if not exists grievances_status_idx   on public.grievances (status, created_at desc);

create table if not exists public.grievance_messages (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances (id) on delete cascade,
  author_kind  text not null check (author_kind in ('employee', 'legal', 'note')),   -- note = private to the handlers
  author_id    uuid,
  body         text not null check (length(btrim(body)) between 1 and 3000),
  created_at   timestamptz not null default now()
);
create index if not exists grievance_messages_idx on public.grievance_messages (grievance_id, id);

create table if not exists public.grievance_events (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances (id) on delete cascade,
  kind         text not null,
  detail       jsonb,
  actor        uuid,
  created_at   timestamptz not null default now()
);
create index if not exists grievance_events_idx on public.grievance_events (grievance_id, id);

-- a handler who steps away from one case (a conflict of interest): it disappears for them
create table if not exists public.grievance_recusals (
  grievance_id uuid not null references public.grievances (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (grievance_id, profile_id)
);

-- files an employee attached. The file itself sits in the private "grievances" bucket under a random name; the name the
-- employee gave it is only kept here. A row is "confirmed" once the file has really been uploaded.
create table if not exists public.grievance_files (
  id           uuid primary key default gen_random_uuid(),
  grievance_id uuid not null references public.grievances (id) on delete cascade,
  path         text not null unique,
  name         text not null check (length(btrim(name)) between 1 and 150),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime         text not null,
  confirmed    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists grievance_files_idx on public.grievance_files (grievance_id);

-- one row of settings, changed by the Administrator
create table if not exists public.grievance_settings (
  id               integer primary key default 1 check (id = 1),
  ack_days         integer not null default 2   check (ack_days between 1 and 30),     -- working days to acknowledge
  update_days      integer not null default 5   check (update_days between 1 and 60),  -- working days between updates
  resolve_days     integer not null default 30  check (resolve_days between 1 and 365),-- calendar days to the resolution target
  retention_months integer check (retention_months is null or retention_months between 1 and 240)  -- null = keep for ever
);
insert into public.grievance_settings (id) values (1) on conflict (id) do nothing;

-- Nobody reaches these from the browser: no grants, row security on, no policies. The website's server functions use the
-- secret key; handlers use the functions in section 5.
alter table public.grievance_counter  enable row level security;
alter table public.grievances         enable row level security;
alter table public.grievance_messages enable row level security;
alter table public.grievance_events   enable row level security;
alter table public.grievance_recusals enable row level security;
alter table public.grievance_files    enable row level security;
alter table public.grievance_settings enable row level security;
revoke all on public.grievance_counter, public.grievances, public.grievance_messages, public.grievance_events,
              public.grievance_recusals, public.grievance_files, public.grievance_settings from anon, authenticated;

-- may THIS signed-in person see ONE grievance? Handlers only, routing respected, and not if they recused themselves.
create or replace function public.grievance_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_handle_grievances() and exists (
    select 1 from public.grievances g, public.profiles p
    where g.id = p_id and p.id = auth.uid()
      and (g.routing = 'legal'
           or (g.routing = 'admin_only' and p.role = 'admin')
           or (g.routing = 'legal_only' and p.role = 'senior_manager'))
      and not exists (select 1 from public.grievance_recusals r where r.grievance_id = g.id and r.profile_id = auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- 3. Ticket numbers and the "last changed" time
-- ---------------------------------------------------------------------------
create or replace function public.grievances_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare y integer := extract(year from (now() at time zone 'Asia/Manila'))::integer; n integer;
begin
  if new.ticket_no is null then
    -- one statement, so two grievances sent at the same moment can never share a number
    insert into public.grievance_counter as c (year, last) values (y, 1)
      on conflict (year) do update set last = c.last + 1
      returning c.last into n;
    new.ticket_no := 'GRV-' || y || '-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
  end if;
  return new;
end $$;
drop trigger if exists grievances_before_insert on public.grievances;
create trigger grievances_before_insert before insert on public.grievances
  for each row execute function public.grievances_before_insert();

-- updated_at moves on every change, unless the change sets it itself
create or replace function public.grievances_before_update() returns trigger
language plpgsql as $$
begin
  if new.updated_at is not distinct from old.updated_at then new.updated_at := now(); end if;
  if new.ticket_no is distinct from old.ticket_no then raise exception 'A ticket number cannot be changed.'; end if;
  return new;
end $$;
drop trigger if exists grievances_before_update on public.grievances;
create trigger grievances_before_update before update on public.grievances
  for each row execute function public.grievances_before_update();

-- ---------------------------------------------------------------------------
-- 4. Time limits
-- ---------------------------------------------------------------------------
-- working days (Monday to Friday, Philippine date) that have passed after p_from, up to and including p_to.
-- Public holidays are not known to the database, so they count as working days.
create or replace function public.grievance_workdays(p_from timestamptz, p_to timestamptz) returns integer
language sql stable as $$
  select count(*)::integer
  from generate_series((p_from at time zone 'Asia/Manila')::date + 1, (p_to at time zone 'Asia/Manila')::date, interval '1 day') d
  where extract(isodow from d) < 6;
$$;

-- why a grievance is overdue (null when it is not): checked in this order
create or replace function public.grievance_due(g public.grievances) returns text
language plpgsql stable security definer set search_path = public as $$
declare s public.grievance_settings;
begin
  select * into s from public.grievance_settings where id = 1;
  if g.status in ('resolved', 'closed') then return null; end if;
  if g.status = 'submitted' and public.grievance_workdays(g.created_at, now()) > s.ack_days then
    return 'Not acknowledged within ' || s.ack_days || ' working days';
  end if;
  if g.status <> 'submitted' and public.grievance_workdays(g.updated_at, now()) > s.update_days then
    return 'No update for more than ' || s.update_days || ' working days';
  end if;
  if now() > g.created_at + make_interval(days => s.resolve_days) then
    return 'Past the ' || s.resolve_days || '-day resolution target';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. What handlers can do (each one checks the rule first, and leaves a trail)
-- ---------------------------------------------------------------------------
-- one line in the activity log: who, what, and the ticket number only (never the complainant)
create or replace function public.grievance_audit(p_action text, p_target text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select email, department into me from public.profiles where id = auth.uid();
  insert into public.audit_log (actor, actor_email, actor_department, action, target, detail)
    values (auth.uid(), me.email, me.department, p_action, p_target, p_detail);
end $$;

create or replace function public.grievance_trail(p_id uuid, p_kind text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  insert into public.grievance_events (grievance_id, kind, detail, actor) values (p_id, p_kind, p_detail, auth.uid());
  -- opens are kept in the case's own trail only
  if p_kind <> 'open' then
    select ticket_no into t from public.grievances where id = p_id;
    perform public.grievance_audit('grievance.' || p_kind, t, p_detail);
  end if;
end $$;

-- stops anyone who may not see this grievance (the message does not say whether it exists)
create or replace function public.grievance_require(p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  if not public.grievance_visible(p_id) then raise exception 'That grievance was not found.'; end if;
end $$;

drop function if exists public.grievance_list();
create or replace function public.grievance_list()
returns table (id uuid, ticket_no text, category text, subject text, confidentiality text, status text, routing text,
               assigned_to uuid, assigned_name text, created_at timestamptz, updated_at timestamptz, last_from text,
               overdue text, file_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  return query
    select g.id, g.ticket_no, g.category, g.subject, g.confidentiality, g.status, g.routing, g.assigned_to,
           p.full_name, g.created_at, g.updated_at,
           (select m.author_kind from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note' order by m.id desc limit 1),
           public.grievance_due(g),
           (select count(*)::integer from public.grievance_files f where f.grievance_id = g.id and f.confirmed)
    from public.grievances g left join public.profiles p on p.id = g.assigned_to
    where public.grievance_visible(g.id)
    -- newest activity first: a case moves up when the employee writes (their messages are not counted in updated_at)
    order by greatest(g.updated_at, coalesce((select max(m.created_at) from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note'), g.updated_at)) desc
    limit 500;
end $$;

create or replace function public.grievance_open(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.grievances; out jsonb;
begin
  perform public.grievance_require(p_id);
  select * into g from public.grievances where id = p_id;
  perform public.grievance_trail(p_id, 'open');
  select jsonb_build_object(
    'grievance', jsonb_build_object(
      'id', g.id, 'ticket_no', g.ticket_no, 'category', g.category, 'subject', g.subject, 'body', g.body,
      'incident_date', g.incident_date, 'location', g.location, 'involved', g.involved,
      'confidentiality', g.confidentiality, 'routing', g.routing, 'status', g.status, 'outcome', g.outcome,
      'overdue', public.grievance_due(g),
      'assigned_to', g.assigned_to, 'assigned_name', (select full_name from public.profiles where id = g.assigned_to),
      'created_at', g.created_at, 'updated_at', g.updated_at, 'acknowledged_at', g.acknowledged_at, 'closed_at', g.closed_at),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.author_kind, 'author', coalesce(pr.full_name, ''),
                  'body', m.body, 'created_at', m.created_at) order by m.id)
                  from public.grievance_messages m left join public.profiles pr on pr.id = m.author_id where m.grievance_id = p_id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'name', f.name, 'size', f.size_bytes, 'mime', f.mime,
                  'created_at', f.created_at) order by f.created_at)
                  from public.grievance_files f where f.grievance_id = p_id and f.confirmed), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x order by x.id desc) from (
                  select e.id, e.kind, e.detail, e.created_at, coalesce(pr.full_name, '') as actor
                  from public.grievance_events e left join public.profiles pr on pr.id = e.actor
                  where e.grievance_id = p_id order by e.id desc limit 100) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

create or replace function public.grievance_set_status(p_id uuid, p_status text, p_outcome text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.grievances; o text;
begin
  perform public.grievance_require(p_id);
  if p_status not in ('submitted','acknowledged','under_review','resolved','escalated','closed') then raise exception 'That status is not allowed.'; end if;
  select * into g from public.grievances where id = p_id for update;
  o := case when p_outcome is not null and btrim(p_outcome) <> '' then btrim(p_outcome) else g.outcome end;
  if p_status in ('resolved', 'closed') and btrim(o) = '' then raise exception 'Write the outcome before resolving or closing.'; end if;
  update public.grievances set
      status = p_status,
      outcome = o,
      assigned_to = case when p_status <> 'submitted' then coalesce(assigned_to, auth.uid()) else assigned_to end,
      acknowledged_at = case when p_status <> 'submitted' then coalesce(acknowledged_at, now()) else acknowledged_at end,
      closed_at = case when p_status = 'closed' then now() else null end
    where id = p_id;
  perform public.grievance_trail(p_id, 'status', jsonb_build_object('from', g.status, 'to', p_status));
end $$;

create or replace function public.grievance_take(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.grievance_require(p_id);
  update public.grievances set assigned_to = auth.uid() where id = p_id;
  perform public.grievance_trail(p_id, 'assign');
end $$;

create or replace function public.grievance_reply(p_id uuid, p_body text, p_private boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.grievance_require(p_id);
  insert into public.grievance_messages (grievance_id, author_kind, author_id, body)
    values (p_id, case when p_private then 'note' else 'legal' end, auth.uid(), btrim(p_body));
  update public.grievances set updated_at = now() where id = p_id;
  perform public.grievance_trail(p_id, case when p_private then 'note' else 'reply' end);
end $$;

-- Who raised a confidential grievance. Anonymous ones have no one to reveal. Every reveal is logged with who asked.
create or replace function public.grievance_reveal(p_id uuid)
returns table (employee_no text, full_name text, job_title text)
language plpgsql security definer set search_path = public as $$
declare g public.grievances;
begin
  perform public.grievance_require(p_id);
  select * into g from public.grievances where id = p_id;
  if g.employee_id is null then raise exception 'This grievance is anonymous. No name was recorded.'; end if;
  perform public.grievance_trail(p_id, 'reveal');
  return query select e.employee_no, e.full_name, e.position as job_title from public.employees e where e.id = g.employee_id;
end $$;

-- A handler steps away from one case (for example, it is about them). It disappears for them, and it is theirs no more.
create or replace function public.grievance_recuse(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.grievance_require(p_id);
  -- the trail is written first: after this the person can no longer see the case
  perform public.grievance_trail(p_id, 'recuse');
  insert into public.grievance_recusals (grievance_id, profile_id) values (p_id, auth.uid()) on conflict do nothing;
  update public.grievances set assigned_to = null where id = p_id and assigned_to = auth.uid();
end $$;

-- a short summary for the dashboard counter
create or replace function public.grievance_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  return (select jsonb_build_object(
    'attention', count(*) filter (where l.status <> 'closed' and (l.status = 'submitted' or l.last_from = 'employee')),
    'overdue',   count(*) filter (where l.overdue is not null),
    'open',      count(*) filter (where l.status <> 'closed'))
    from public.grievance_list() l);
end $$;

-- (an earlier version had a statistics function; it is gone)
drop function if exists public.grievance_stats();

-- Permanently deletes ONE grievance with its messages, trail and file records. Any handler who may see it can do this. The
-- activity log keeps a line with the ticket number and who did it (never the complainant). Returns the paths of files that were
-- never confirmed, so the screen can try to remove those too; the confirmed files are removed by the screen BEFORE this runs,
-- while the person can still see them.
create or replace function public.grievance_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; leftover text[];
begin
  perform public.grievance_require(p_id);
  select ticket_no into t from public.grievances where id = p_id;
  select coalesce(array_agg(f.path), '{}') into leftover from public.grievance_files f where f.grievance_id = p_id and not f.confirmed;
  perform public.grievance_audit('grievance.delete', t, null);
  delete from public.grievances where id = p_id;
  return jsonb_build_object('deleted', true, 'leftover', to_jsonb(leftover));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Settings and retention (the Administrator only changes them)
-- ---------------------------------------------------------------------------
create or replace function public.grievance_get_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  return (select to_jsonb(s) - 'id' from public.grievance_settings s where s.id = 1);
end $$;

create or replace function public.grievance_set_settings(p_ack integer, p_update integer, p_resolve integer, p_retention integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.grievance_is_admin() then raise exception 'Only the Administrator can change these settings.'; end if;
  update public.grievance_settings set ack_days = p_ack, update_days = p_update, resolve_days = p_resolve, retention_months = p_retention where id = 1;
  perform public.grievance_audit('grievance.settings', null, jsonb_build_object('ack_days', p_ack, 'update_days', p_update, 'resolve_days', p_resolve, 'retention_months', p_retention));
end $$;

-- how many closed cases are past the retention period (nothing is deleted by looking)
create or replace function public.grievance_purge_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m integer;
begin
  if not public.grievance_is_admin() then raise exception 'Only the Administrator can do this.'; end if;
  select retention_months into m from public.grievance_settings where id = 1;
  return jsonb_build_object('retention_months', m,
    'eligible', case when m is null then 0 else (select count(*) from public.grievances g where g.status = 'closed' and g.closed_at < now() - make_interval(months => m)) end);
end $$;

-- Deletes closed cases past the retention period, with their messages and file records. Returns the file paths so the
-- screen can remove the files from storage. Leftover half-finished uploads older than a day go too.
create or replace function public.grievance_purge() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m integer; ids uuid[]; paths text[]; n integer;
begin
  if not public.grievance_is_admin() then raise exception 'Only the Administrator can do this.'; end if;
  select retention_months into m from public.grievance_settings where id = 1;
  if m is null then raise exception 'Set a retention period first. Until then nothing is deleted.'; end if;
  select coalesce(array_agg(g.id), '{}') into ids from public.grievances g where g.status = 'closed' and g.closed_at < now() - make_interval(months => m);
  n := coalesce(array_length(ids, 1), 0);
  select coalesce(array_agg(f.path), '{}') into paths from public.grievance_files f
    where f.grievance_id = any(ids) or (not f.confirmed and f.created_at < now() - interval '1 day');
  delete from public.grievance_files where not confirmed and created_at < now() - interval '1 day';
  delete from public.grievances where id = any(ids);
  perform public.grievance_audit('grievance.purge', null, jsonb_build_object('deleted', n, 'retention_months', m));
  return jsonb_build_object('deleted', n, 'paths', to_jsonb(paths));
end $$;

-- ---------------------------------------------------------------------------
-- 7. The daily summary email (called by the website's server with the secret key, never from a browser)
--    Only counts: no ticket numbers, no names, no text, and nothing that carries the time an anonymous grievance was sent.
-- ---------------------------------------------------------------------------
create or replace function public.grievance_digest() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', (select jsonb_build_object(
        'unacknowledged', count(*) filter (where g.status = 'submitted'),
        'awaiting_reply', count(*) filter (where g.status <> 'closed' and (select m.author_kind from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note' order by m.id desc limit 1) = 'employee'),
        'overdue', count(*) filter (where public.grievance_due(g) is not null))
      from public.grievances g where g.routing in ('legal', 'admin_only')),
    'legal', (select jsonb_build_object(
        'unacknowledged', count(*) filter (where g.status = 'submitted'),
        'awaiting_reply', count(*) filter (where g.status <> 'closed' and (select m.author_kind from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note' order by m.id desc limit 1) = 'employee'),
        'overdue', count(*) filter (where public.grievance_due(g) is not null))
      from public.grievances g where g.routing in ('legal', 'legal_only')));
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'can_handle_grievances()', 'grievance_is_admin()', 'grievance_visible(uuid)', 'grievance_workdays(timestamptz,timestamptz)',
    'grievance_audit(text,text,jsonb)', 'grievance_trail(uuid,text,jsonb)', 'grievance_require(uuid)', 'grievance_due(public.grievances)',
    'grievance_list()', 'grievance_open(uuid)', 'grievance_set_status(uuid,text,text)', 'grievance_take(uuid)',
    'grievance_reply(uuid,text,boolean)', 'grievance_reveal(uuid)', 'grievance_recuse(uuid)', 'grievance_delete(uuid)', 'grievance_counts()',
    'grievance_get_settings()', 'grievance_set_settings(integer,integer,integer,integer)', 'grievance_purge_preview()', 'grievance_purge()',
    'grievance_digest()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- the ones a signed-in manager may call (each checks the rule itself)
  -- (grievance_is_admin is also used by the storage delete rule, which runs with the caller's own permissions)
  foreach f in array array[
    'can_handle_grievances()', 'grievance_is_admin()', 'grievance_list()', 'grievance_open(uuid)', 'grievance_set_status(uuid,text,text)', 'grievance_take(uuid)',
    'grievance_reply(uuid,text,boolean)', 'grievance_reveal(uuid)', 'grievance_recuse(uuid)', 'grievance_delete(uuid)', 'grievance_counts()',
    'grievance_get_settings()', 'grievance_set_settings(integer,integer,integer,integer)', 'grievance_purge_preview()', 'grievance_purge()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- the daily summary is for the server only
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.grievance_digest() to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The file bucket, and who may open a file
-- ---------------------------------------------------------------------------
-- may this signed-in person see the file stored at this path? A confirmed file of a grievance they may see. Also, for the
-- Administrator only, a file that no record points to any more (left over after a purge), so it can be removed from storage.
-- (Files of a live case still follow the routing rules, so the Administrator cannot reach those of a case that involves them.)
create or replace function public.grievance_file_visible(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.grievance_files f where f.path = p_path and f.confirmed and public.grievance_visible(f.grievance_id))
      or (public.grievance_is_admin() and not exists (select 1 from public.grievance_files f where f.path = p_path));
$$;
revoke all on function public.grievance_file_visible(text) from public, anon;
grant execute on function public.grievance_file_visible(text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage is not available here: the grievances bucket was not created.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('grievances', 'grievances', false, 10485760,
          array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "grievances: handlers read" on storage.objects;
  create policy "grievances: handlers read" on storage.objects for select to authenticated
    using (bucket_id = 'grievances' and public.grievance_file_visible(name));
  drop policy if exists "grievances: administrator removes" on storage.objects;
  drop policy if exists "grievances: handlers remove" on storage.objects;
  create policy "grievances: handlers remove" on storage.objects for delete to authenticated
    using (bucket_id = 'grievances' and (public.grievance_is_admin() or public.grievance_file_visible(name)));
end $$;

-- ---------------------------------------------------------------------------
-- 10. The card on the Legal Compliance page of the Content tab (only handlers are shown it)
-- ---------------------------------------------------------------------------
insert into public.deliverables (key, name, department, kind, allow_public)
values ('grievances', 'Grievance Management System', 'legal', 'special', false)
on conflict (key) do update set name = excluded.name, department = excluded.department, kind = excluded.kind, allow_public = excluded.allow_public;
