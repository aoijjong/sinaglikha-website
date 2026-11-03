-- SINAGLIKHA Performance Management System, part 4: deleting forms and evaluations
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/phase7.sql to have been run first.
--
-- 1. A form with evaluations written from it can now be deleted. The evaluations keep their own copy of the
--    questions and are not changed.
-- 2. A manager evaluation can be deleted, finalised or not, by the Senior Manager who wrote it or by
--    Total Rewards / the Administrator. (Self and peer evaluations: Total Rewards / the Administrator, as before.)

create or replace function public.evaluations_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb; r numeric; w numeric; mx numeric; got numeric := 0; tot numeric := 0; blocked boolean := false;
        p record; typ text; req boolean; answered boolean;
begin
  -- Deleting a form sets scorecard_id to null on the evaluations written with it. Let that one change through
  -- untouched (a signed-in person has no right to change scorecard_id, so only the database itself does this).
  if tg_op = 'UPDATE' then
    if old.scorecard_id is not null and new.scorecard_id is null then
      return new;
    end if;
    if old.status = 'final' and new.status = 'final' then
      raise exception 'This evaluation is finalised. Reopen it to make changes.';
    end if;
  end if;
  if new.scorecard_id is not null then
    select s.category into new.category from public.scorecards s where s.id = new.scorecard_id;
  end if;
  for c in select * from jsonb_array_elements(new.criteria) loop
    typ := coalesce(c->>'type', 'rating');
    if typ in ('rating', 'stars') then
      req := coalesce((c->>'required')::boolean, true);
      mx := case when typ = 'stars' then 5 else new.scale_max end;
      w := coalesce((c->>'weight')::numeric, 0);
      if w <= 0 then raise exception 'Each scored question needs a weight above zero.'; end if;
      if c->>'rating' is not null then
        r := (c->>'rating')::numeric;
        if r < 1 or r > mx or r <> trunc(r) then
          raise exception 'Ratings must be whole numbers from 1 to %.', mx;
        end if;
        got := got + (r / mx) * w;
        tot := tot + w;
      elsif req then
        blocked := true;
        tot := tot + w;
      end if;
    else
      req := coalesce((c->>'required')::boolean, false);
      if typ in ('choice', 'checkbox', 'dropdown') then
        answered := case when coalesce(jsonb_typeof(c->'picked'), '') = 'array' then jsonb_array_length(c->'picked') > 0 else false end;
      else
        answered := length(btrim(coalesce(c->>'comment', ''))) > 0;
      end if;
      if req and not answered then blocked := true; end if;
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

drop policy if exists "evaluations: evaluators delete" on public.evaluations;
create policy "evaluations: evaluators delete" on public.evaluations for delete to authenticated
  using (
    (category = 'manager' and public.is_manager() and (evaluator_id = auth.uid() or public.can_evaluate()))
    or (category in ('self', 'peer') and public.can_evaluate())
  );
