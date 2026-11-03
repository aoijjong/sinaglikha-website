-- SINAGLIKHA Performance Management System, part 2: Self, Peer and Manager evaluation forms
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/phase5.sql to have been run first.
--
-- The scorecards of phase5 become "Evaluation forms". Total Rewards (and the Administrator) build them,
-- and each one is for one category:
--   self     every employee fills it in about themselves (they see it on their dashboard)
--   peer     any employee may fill it in about a colleague whose name they type
--   manager  any Senior Manager fills it in about an employee
-- Who can read the answers:
--   self and peer   Total Rewards and the Administrator only
--   manager         every Senior Manager (each one edits only their own)
-- Employees send their answers through the server (/api/employee-evaluate), never straight to the
-- database, so there is no employee-facing policy below.

-- ---------------------------------------------------------------------------
-- 1. Forms: a category, a period and optional open dates; questions can be a rating or a written answer
--    criteria = [{ "id","type":"rating"|"text","title","description","weight","required" }, ...]
-- ---------------------------------------------------------------------------
alter table public.scorecards add column if not exists category text not null default 'manager';
alter table public.scorecards drop constraint if exists scorecards_category_check;
alter table public.scorecards add constraint scorecards_category_check check (category in ('self', 'peer', 'manager'));
alter table public.scorecards add column if not exists period text not null default '';
alter table public.scorecards drop constraint if exists scorecards_period_check;
alter table public.scorecards add constraint scorecards_period_check check (length(period) <= 60);
alter table public.scorecards add column if not exists opens_on date;
alter table public.scorecards add column if not exists closes_on date;

create or replace function public.scorecards_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb; typ text;
begin
  for c in select * from jsonb_array_elements(new.criteria) loop
    typ := coalesce(c->>'type', 'rating');
    if jsonb_typeof(c) <> 'object'
       or length(btrim(coalesce(c->>'title', ''))) not between 1 and 160
       or typ not in ('rating', 'text') then
      raise exception 'Each question needs a title and a type of rating or text.';
    end if;
    if typ = 'rating' and (coalesce((c->>'weight')::numeric, 0) <= 0 or coalesce((c->>'weight')::numeric, 0) > 100) then
      raise exception 'Each rating question needs a weight between 1 and 100.';
    end if;
  end loop;
  if new.opens_on is not null and new.closes_on is not null and new.closes_on < new.opens_on then
    raise exception 'The closing date is before the opening date.';
  end if;
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
revoke all on function public.scorecards_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Evaluations: a category, and who wrote it
--    manager: employee_id = who is evaluated, evaluator_id = the Senior Manager
--    self:    employee_id = evaluator_employee_id = the employee
--    peer:    employee_id = the colleague, evaluator_employee_id = the employee who wrote it
-- ---------------------------------------------------------------------------
alter table public.evaluations add column if not exists category text not null default 'manager';
alter table public.evaluations drop constraint if exists evaluations_category_check;
alter table public.evaluations add constraint evaluations_category_check check (category in ('self', 'peer', 'manager'));
alter table public.evaluations add column if not exists evaluator_employee_id uuid references public.employees (id);

-- Several people may now evaluate the same employee for the same form and period (one each).
alter table public.evaluations drop constraint if exists evaluations_employee_id_scorecard_title_period_key;
drop index if exists public.evaluations_one_per_evaluator;
create unique index evaluations_one_per_evaluator on public.evaluations
  (employee_id, scorecard_title, period, coalesce(evaluator_id::text, evaluator_employee_id::text, ''));

-- Checks the answers, works out the score (the rated questions, weighted, as a percentage of the best
-- possible), stamps who wrote it, and keeps a finalised evaluation from being edited.
create or replace function public.evaluations_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb; r numeric; w numeric; got numeric := 0; tot numeric := 0; blocked boolean := false;
        p record; typ text; req boolean;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'final' and new.status = 'final' then
      raise exception 'This evaluation is finalised. Reopen it to make changes.';
    end if;
  end if;
  if new.scorecard_id is not null then
    select s.category into new.category from public.scorecards s where s.id = new.scorecard_id;
  end if;
  for c in select * from jsonb_array_elements(new.criteria) loop
    typ := coalesce(c->>'type', 'rating');
    if typ = 'text' then
      req := coalesce((c->>'required')::boolean, false);
      if req and length(btrim(coalesce(c->>'comment', ''))) = 0 then blocked := true; end if;
      continue;
    end if;
    req := coalesce((c->>'required')::boolean, true);
    w := coalesce((c->>'weight')::numeric, 0);
    if w <= 0 then raise exception 'Each rating question needs a weight above zero.'; end if;
    if c->>'rating' is not null then
      r := (c->>'rating')::numeric;
      if r < 1 or r > new.scale_max or r <> trunc(r) then
        raise exception 'Ratings must be whole numbers from 1 to %.', new.scale_max;
      end if;
      got := got + (r / new.scale_max) * w;
      tot := tot + w;
    elsif req then
      blocked := true;
      tot := tot + w;
    end if;
  end loop;
  if new.status = 'final' and blocked then
    raise exception 'Answer every required question before you finalise.';
  end if;
  new.score := case when tot > 0 and not blocked then round((got / tot) * 100, 1) else null end;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
      new.evaluator_id   := auth.uid();
      new.evaluator_name := coalesce(nullif(btrim(p.full_name), ''), p.email, '');
    elsif new.evaluator_employee_id is not null then
      select e.full_name into p from public.employees e where e.id = new.evaluator_employee_id;
      new.evaluator_name := coalesce(p.full_name, '');
    end if;
    new.created_at      := now();
    new.scorecard_title := btrim(new.scorecard_title);
  else
    new.evaluator_id          := old.evaluator_id;
    new.evaluator_employee_id := old.evaluator_employee_id;
    new.evaluator_name        := old.evaluator_name;
    new.employee_id           := old.employee_id;
    new.scorecard_id          := old.scorecard_id;
    new.scorecard_title       := old.scorecard_title;
    new.scale_max             := old.scale_max;
    new.category              := old.category;
    new.created_at            := old.created_at;
  end if;
  if new.status = 'final' then new.finalized_at := now(); else new.finalized_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.evaluations_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rules
-- ---------------------------------------------------------------------------
grant insert (title, description, scale_max, labels, criteria, active, category, period, opens_on, closes_on) on public.scorecards to authenticated;
grant update (title, description, scale_max, labels, criteria, active, category, period, opens_on, closes_on) on public.scorecards to authenticated;

drop policy if exists "scorecards: evaluators read" on public.scorecards;
create policy "scorecards: evaluators read" on public.scorecards for select to authenticated
  using (public.can_evaluate() or (category = 'manager' and active and public.is_manager()));
-- add / change / delete stay with Total Rewards and the Administrator (phase5.sql)

drop policy if exists "evaluations: evaluators read"   on public.evaluations;
drop policy if exists "evaluations: evaluators add"    on public.evaluations;
drop policy if exists "evaluations: evaluators change" on public.evaluations;
drop policy if exists "evaluations: evaluators delete" on public.evaluations;

-- Total Rewards and the Administrator read everything; every Senior Manager reads manager evaluations
create policy "evaluations: evaluators read" on public.evaluations for select to authenticated
  using (public.can_evaluate() or (category = 'manager' and public.is_manager()));
-- any Senior Manager can start a manager evaluation from a form (self and peer come in through the server)
create policy "evaluations: evaluators add" on public.evaluations for insert to authenticated
  with check (category = 'manager' and scorecard_id is not null and public.is_manager() and evaluator_id = auth.uid());
-- a manager evaluation is changed by the Senior Manager who wrote it, or by Total Rewards / the Administrator
create policy "evaluations: evaluators change" on public.evaluations for update to authenticated
  using (category = 'manager' and public.is_manager() and (evaluator_id = auth.uid() or public.can_evaluate()))
  with check (category = 'manager' and public.is_manager() and (evaluator_id = auth.uid() or public.can_evaluate()));
-- drafts can be deleted by their author or by Total Rewards; Total Rewards can also remove a self or peer
-- evaluation (for example so an employee can redo it)
create policy "evaluations: evaluators delete" on public.evaluations for delete to authenticated
  using (
    (category = 'manager' and status = 'draft' and public.is_manager() and (evaluator_id = auth.uid() or public.can_evaluate()))
    or (category in ('self', 'peer') and public.can_evaluate())
  );
