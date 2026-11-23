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
--   Handlers    Legal Compliance Senior Managers and the Administrator, only. Every other Senior Manager sees nothing.
--   Handlers never read the tables directly. They use the functions below, which check the rule, hide the
--   complainant's identity until "reveal", and write the activity log.
-- Ticket numbers look like GRV-2026-0001: a counter that restarts each year, handed out by the database.

-- ---------------------------------------------------------------------------
-- 1. The rule: who handles grievances
-- ---------------------------------------------------------------------------
create or replace function public.can_handle_grievances() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'legal')));
$$;
revoke all on function public.can_handle_grievances() from public, anon;
grant execute on function public.can_handle_grievances() to authenticated;

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

-- Nobody reaches these from the browser: no grants, row security on, no policies. The website's server functions use the
-- secret key; handlers use the functions in section 4.
alter table public.grievance_counter  enable row level security;
alter table public.grievances         enable row level security;
alter table public.grievance_messages enable row level security;
alter table public.grievance_events   enable row level security;
revoke all on public.grievance_counter, public.grievances, public.grievance_messages, public.grievance_events from anon, authenticated;

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

-- updated_at moves on every change, unless the change sets it itself (anonymous cases keep it rounded to the day)
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
-- 4. What handlers can do (each one checks the rule first, and leaves a trail)
-- ---------------------------------------------------------------------------
create or replace function public.grievance_trail(p_id uuid, p_kind text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare t text; me record;
begin
  insert into public.grievance_events (grievance_id, kind, detail, actor) values (p_id, p_kind, p_detail, auth.uid());
  -- the activity log gets the ticket number only, never the complainant; opens are kept in the case's own trail
  if p_kind <> 'open' then
    select ticket_no into t from public.grievances where id = p_id;
    select email, department into me from public.profiles where id = auth.uid();
    insert into public.audit_log (actor, actor_email, actor_department, action, target, detail)
      values (auth.uid(), me.email, me.department, 'grievance.' || p_kind, t, p_detail);
  end if;
end $$;
revoke all on function public.grievance_trail(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.grievance_list()
returns table (id uuid, ticket_no text, category text, subject text, confidentiality text, status text,
               assigned_to uuid, assigned_name text, created_at timestamptz, updated_at timestamptz, last_from text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  return query
    select g.id, g.ticket_no, g.category, g.subject, g.confidentiality, g.status, g.assigned_to,
           p.full_name, g.created_at, g.updated_at,
           (select m.author_kind from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note' order by m.id desc limit 1)
    from public.grievances g left join public.profiles p on p.id = g.assigned_to
    -- newest activity first: a case moves up when the employee writes (their messages are not counted in updated_at)
    order by greatest(g.updated_at, coalesce((select max(m.created_at) from public.grievance_messages m where m.grievance_id = g.id and m.author_kind <> 'note'), g.updated_at)) desc
    limit 500;
end $$;

create or replace function public.grievance_open(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.grievances; out jsonb;
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can open grievances.'; end if;
  select * into g from public.grievances where id = p_id;
  if not found then raise exception 'That grievance was not found.'; end if;
  perform public.grievance_trail(p_id, 'open');
  select jsonb_build_object(
    'grievance', jsonb_build_object(
      'id', g.id, 'ticket_no', g.ticket_no, 'category', g.category, 'subject', g.subject, 'body', g.body,
      'incident_date', g.incident_date, 'location', g.location, 'involved', g.involved,
      'confidentiality', g.confidentiality, 'status', g.status, 'outcome', g.outcome,
      'assigned_to', g.assigned_to, 'assigned_name', (select full_name from public.profiles where id = g.assigned_to),
      'created_at', g.created_at, 'updated_at', g.updated_at, 'acknowledged_at', g.acknowledged_at, 'closed_at', g.closed_at),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.author_kind, 'author', coalesce(pr.full_name, ''),
                  'body', m.body, 'created_at', m.created_at) order by m.id)
                  from public.grievance_messages m left join public.profiles pr on pr.id = m.author_id where m.grievance_id = p_id), '[]'::jsonb),
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
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can change grievances.'; end if;
  if p_status not in ('submitted','acknowledged','under_review','resolved','escalated','closed') then raise exception 'That status is not allowed.'; end if;
  select * into g from public.grievances where id = p_id for update;
  if not found then raise exception 'That grievance was not found.'; end if;
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
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can change grievances.'; end if;
  update public.grievances set assigned_to = auth.uid() where id = p_id;
  if not found then raise exception 'That grievance was not found.'; end if;
  perform public.grievance_trail(p_id, 'assign');
end $$;

create or replace function public.grievance_reply(p_id uuid, p_body text, p_private boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can reply.'; end if;
  if not exists (select 1 from public.grievances where id = p_id) then raise exception 'That grievance was not found.'; end if;
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
  if not public.can_handle_grievances() then raise exception 'Only Legal Compliance and the Administrator can do this.'; end if;
  select * into g from public.grievances where id = p_id;
  if not found then raise exception 'That grievance was not found.'; end if;
  if g.employee_id is null then raise exception 'This grievance is anonymous. No name was recorded.'; end if;
  perform public.grievance_trail(p_id, 'reveal');
  return query select e.employee_no, e.full_name, e.position as job_title from public.employees e where e.id = g.employee_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['grievance_list()', 'grievance_open(uuid)', 'grievance_set_status(uuid,text,text)', 'grievance_take(uuid)',
                           'grievance_reply(uuid,text,boolean)', 'grievance_reveal(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The card on the Legal Compliance page of the Content tab (only handlers are shown it)
-- ---------------------------------------------------------------------------
insert into public.deliverables (key, name, department, kind, allow_public)
values ('grievances', 'Grievances', 'legal', 'special', false)
on conflict (key) do update set name = excluded.name, department = excluded.department, kind = excluded.kind, allow_public = excluded.allow_public;
