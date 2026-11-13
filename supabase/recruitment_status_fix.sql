-- SINAGLIKHA recruitment: fix for applicant statuses that would not change
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/recruitment.sql to have been run first.
--
-- The problem: applicants_stamp() keeps a status from being edited directly by putting the old value back on
-- every update. The function applicant_set_status() changes the status with an update too, so its change was
-- put back as well: the history said "status changed" but the applicant stayed on the old status.
-- The fix: applicant_set_status() raises a flag for its own update only, and the trigger lets a status change
-- through when that flag is up. Nothing else can raise it (no browser request can set it), so a status still
-- cannot be changed any other way.

create or replace function public.applicants_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.reference is null or btrim(new.reference) = '' then
      new.reference := 'APP-' || to_char((now() at time zone 'Asia/Manila'), 'YYYY') || '-' || lpad(nextval('public.applicant_ref_seq')::text, 4, '0');
    end if;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.created_at := now();
    new.status_changed_at := now();
  else
    new.reference := old.reference;
    if coalesce(current_setting('sng.status_change', true), '') <> '1' then
      new.status := old.status;                       -- a status changes only through applicant_set_status()
      new.status_changed_at := old.status_changed_at;
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.applicants_stamp() from public, anon, authenticated;

create or replace function public.applicant_set_status(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare old_status text; p record;
begin
  if not public.can_manage_recruitment() then raise exception 'Not allowed.'; end if;
  if p_status not in ('new', 'screening', 'shortlisted', 'interview', 'work_sample', 'final_review', 'selected', 'not_selected', 'placed', 'withdrawn') then
    raise exception 'Unknown status.';
  end if;
  select a.status into old_status from public.applicants a where a.id = p_id for update;
  if not found then raise exception 'Applicant not found.'; end if;
  if old_status = p_status then return; end if;
  perform set_config('sng.status_change', '1', true);        -- lets the trigger accept this one update
  update public.applicants set status = p_status, status_changed_at = now(), updated_at = now() where id = p_id;
  perform set_config('sng.status_change', '', true);
  select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
  insert into public.applicant_events (applicant_id, kind, from_status, to_status, note, by_id, by_name)
  values (p_id, 'status', old_status, p_status, left(coalesce(p_note, ''), 2000), auth.uid(), coalesce(nullif(btrim(p.full_name), ''), p.email, ''));
end;
$$;
revoke all on function public.applicant_set_status(uuid, text, text) from public, anon;
grant execute on function public.applicant_set_status(uuid, text, text) to authenticated;

-- Applicants whose history says "status changed" but who never moved (from the days the bug was live) are set
-- to the last status their history recorded, so the table and the history agree.
update public.applicants a
   set status = e.to_status, status_changed_at = e.created_at
  from (select distinct on (applicant_id) applicant_id, to_status, created_at
          from public.applicant_events where kind = 'status' order by applicant_id, created_at desc) e
 where e.applicant_id = a.id and a.status <> e.to_status;
