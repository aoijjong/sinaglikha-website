-- SINAGLIKHA Performance Management System: scorecards and employee evaluations
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/schema.sql, supabase/employees.sql and supabase/restricted_records.sql to have been run first.
--
-- Total Rewards (and the Administrator) build their own scorecards: a list of criteria, each with a
-- weight, rated on a scale such as 1 to 5. They then evaluate an employee against a scorecard for a
-- period. Evaluations are private to Total Rewards and the Administrator: no other Senior Manager and
-- no employee can read them. The old employee-facing evaluation form links (evaluation_setups from
-- phase2.sql) are no longer shown anywhere; that table is left alone.

-- ---------------------------------------------------------------------------
-- 1. Who may evaluate
-- ---------------------------------------------------------------------------
create or replace function public.can_evaluate() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or (p.role = 'senior_manager' and p.department = 'rewards')));
$$;
revoke all on function public.can_evaluate() from public, anon;
grant execute on function public.can_evaluate() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Scorecards: a reusable list of criteria
--    criteria = [{ "id": "...", "title": "...", "description": "...", "weight": 20 }, ...]
-- ---------------------------------------------------------------------------
create table if not exists public.scorecards (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  scale_max   int  not null default 5 check (scale_max between 3 and 10),
  labels      jsonb not null default '[]'::jsonb check (jsonb_typeof(labels) = 'array' and jsonb_array_length(labels) <= 10),
  criteria    jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 30),
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.scorecards enable row level security;

create or replace function public.scorecards_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  for c in select * from jsonb_array_elements(new.criteria) loop
    if jsonb_typeof(c) <> 'object'
       or length(btrim(coalesce(c->>'title', ''))) not between 1 and 160
       or coalesce((c->>'weight')::numeric, 0) <= 0 or coalesce((c->>'weight')::numeric, 0) > 100 then
      raise exception 'Each criterion needs a title and a weight between 1 and 100.';
    end if;
  end loop;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists scorecards_stamp_trigger on public.scorecards;
create trigger scorecards_stamp_trigger before insert or update on public.scorecards
  for each row execute function public.scorecards_stamp();
revoke all on function public.scorecards_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Evaluations: one employee, one scorecard, one period.
--    The scorecard is copied in when the evaluation starts, so changing or deleting the scorecard
--    later never changes an evaluation already written.
--    criteria = [{ "id","title","description","weight","rating": 4,"comment":"..." }, ...]
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees (id),
  scorecard_id    uuid references public.scorecards (id) on delete set null,
  scorecard_title text not null check (length(btrim(scorecard_title)) between 1 and 160),
  period          text not null check (length(btrim(period)) between 1 and 60),
  scale_max       int  not null check (scale_max between 3 and 10),
  criteria        jsonb not null check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 30),
  overall_comment text not null default '' check (length(overall_comment) <= 3000),
  score           numeric(5,1),
  status          text not null default 'draft' check (status in ('draft', 'final')),
  evaluator_id    uuid,
  evaluator_name  text not null default '',
  finalized_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, scorecard_title, period)
);
create index if not exists evaluations_employee_idx on public.evaluations (employee_id, created_at desc);
alter table public.evaluations enable row level security;

-- Checks the ratings, works out the score (a percentage of the best possible, weighted), stamps who
-- wrote it, and keeps a finalised evaluation from being edited (reopen it first).
create or replace function public.evaluations_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb; r numeric; w numeric; got numeric := 0; tot numeric := 0; missing boolean := false; p record;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'final' and new.status = 'final' then
      raise exception 'This evaluation is finalised. Reopen it to make changes.';
    end if;
  end if;
  for c in select * from jsonb_array_elements(new.criteria) loop
    w := coalesce((c->>'weight')::numeric, 0);
    if w <= 0 then raise exception 'Each criterion needs a weight above zero.'; end if;
    if c->>'rating' is not null then
      r := (c->>'rating')::numeric;
      if r < 1 or r > new.scale_max or r <> trunc(r) then
        raise exception 'Ratings must be whole numbers from 1 to %.', new.scale_max;
      end if;
      got := got + (r / new.scale_max) * w;
      tot := tot + w;
    else
      missing := true;
      tot := tot + w;
    end if;
  end loop;
  if new.status = 'final' and missing then
    raise exception 'Rate every criterion before you finalise.';
  end if;
  new.score := case when tot > 0 and not missing then round((got / tot) * 100, 1) else null end;
  if tg_op = 'INSERT' then
    select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
    new.evaluator_id   := auth.uid();
    new.evaluator_name := coalesce(nullif(btrim(p.full_name), ''), p.email, '');
    new.created_at     := now();
    new.scorecard_title := btrim(new.scorecard_title);
  else
    new.evaluator_id   := old.evaluator_id;
    new.evaluator_name := old.evaluator_name;
    new.employee_id    := old.employee_id;
    new.scorecard_id   := old.scorecard_id;
    new.scorecard_title := old.scorecard_title;
    new.scale_max      := old.scale_max;
    new.created_at     := old.created_at;
  end if;
  if new.status = 'final' then new.finalized_at := now(); else new.finalized_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists evaluations_stamp_trigger on public.evaluations;
create trigger evaluations_stamp_trigger before insert or update on public.evaluations
  for each row execute function public.evaluations_stamp();
revoke all on function public.evaluations_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rules: Total Rewards and the Administrator only
-- ---------------------------------------------------------------------------
revoke all on public.scorecards, public.evaluations from anon, authenticated;
grant select, delete on public.scorecards to authenticated;
grant insert (title, description, scale_max, labels, criteria, active) on public.scorecards to authenticated;
grant update (title, description, scale_max, labels, criteria, active) on public.scorecards to authenticated;
grant select on public.evaluations to authenticated;
grant insert (employee_id, scorecard_id, scorecard_title, period, scale_max, criteria, overall_comment, status) on public.evaluations to authenticated;
grant update (period, criteria, overall_comment, status) on public.evaluations to authenticated;
grant delete on public.evaluations to authenticated;

drop policy if exists "scorecards: evaluators read"   on public.scorecards;
drop policy if exists "scorecards: evaluators add"    on public.scorecards;
drop policy if exists "scorecards: evaluators change" on public.scorecards;
drop policy if exists "scorecards: evaluators delete" on public.scorecards;
drop policy if exists "evaluations: evaluators read"   on public.evaluations;
drop policy if exists "evaluations: evaluators add"    on public.evaluations;
drop policy if exists "evaluations: evaluators change" on public.evaluations;
drop policy if exists "evaluations: evaluators delete" on public.evaluations;

create policy "scorecards: evaluators read"   on public.scorecards for select to authenticated using (public.can_evaluate());
create policy "scorecards: evaluators add"    on public.scorecards for insert to authenticated with check (public.can_evaluate());
create policy "scorecards: evaluators change" on public.scorecards for update to authenticated using (public.can_evaluate()) with check (public.can_evaluate());
create policy "scorecards: evaluators delete" on public.scorecards for delete to authenticated using (public.can_evaluate());

create policy "evaluations: evaluators read"   on public.evaluations for select to authenticated using (public.can_evaluate());
create policy "evaluations: evaluators add"    on public.evaluations for insert to authenticated with check (public.can_evaluate());
create policy "evaluations: evaluators change" on public.evaluations for update to authenticated using (public.can_evaluate()) with check (public.can_evaluate());
-- only a draft can be deleted; a finalised evaluation has to be reopened first
create policy "evaluations: evaluators delete" on public.evaluations for delete to authenticated using (public.can_evaluate() and status = 'draft');
