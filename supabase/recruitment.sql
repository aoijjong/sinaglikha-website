-- SINAGLIKHA Staffing and Recruitment, part 2: recruitment records and applicant tracking
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs supabase/careers.sql to have been run first.
--
-- Three things are added:
--   1. an optional "Apply Now" link on each vacancy (the address behind the QR code on its poster);
--   2. a private library for recruitment documents (interview schedules, rating forms, work sample
--      ratings, selection results, placement records);
--   3. applicant tracking: applicants, their status, a history of status changes, and internal notes.
-- Applications themselves are NOT collected here. Applicants use the QR code on the poster; the
-- managers bring the applicants in by CSV import or by typing them in.
--
-- Who can use it: public.can_manage_recruitment() from careers.sql, which is the Administrator and the
-- Senior Manager of Staffing and Recruitment. Nobody else (employees, other managers, the public) can
-- read or change any of it, and the documents are in a private bucket reached only with short-lived links.

-- ---------------------------------------------------------------------------
-- 1. An optional application link on each vacancy
-- ---------------------------------------------------------------------------
alter table public.vacancies add column if not exists apply_url text not null default '';
alter table public.vacancies drop constraint if exists vacancies_apply_url_check;
alter table public.vacancies add constraint vacancies_apply_url_check
  check (apply_url = '' or (apply_url ~* '^https://[^[:space:]]+$' and length(apply_url) <= 500));
grant select (apply_url) on public.vacancies to anon;

-- ---------------------------------------------------------------------------
-- 2. Recruitment and Selection Records: one document library
-- ---------------------------------------------------------------------------
create table if not exists public.recruitment_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 1 and 160),
  category      text not null check (category in ('interview_schedule', 'interview_rating', 'work_sample', 'selection_result', 'placement')),
  description   text not null default '' check (length(description) <= 1000),
  vacancy_id    uuid references public.vacancies (id) on delete set null,
  batch         text not null default '' check (length(batch) <= 80),
  file_path     text not null check (length(file_path) between 1 and 300),
  file_name     text not null default '' check (length(file_name) <= 200),
  file_size     bigint not null default 0,
  version       integer not null default 1,
  uploaded_by   uuid,
  uploader_name text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists recruitment_documents_idx on public.recruitment_documents (category, created_at desc);
alter table public.recruitment_documents enable row level security;

create or replace function public.recruitment_documents_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
    new.uploaded_by := auth.uid();
    new.uploader_name := coalesce(nullif(btrim(p.full_name), ''), p.email, '');
    new.created_at := now();
    new.version := 1;
  else
    new.uploaded_by := old.uploaded_by;
    new.uploader_name := old.uploader_name;
    new.created_at := old.created_at;
    -- replacing the file counts as a new version
    new.version := case when new.file_path is distinct from old.file_path then old.version + 1 else old.version end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.recruitment_documents_stamp() from public, anon, authenticated;
drop trigger if exists recruitment_documents_stamp_trigger on public.recruitment_documents;
create trigger recruitment_documents_stamp_trigger before insert or update on public.recruitment_documents
  for each row execute function public.recruitment_documents_stamp();

revoke all on public.recruitment_documents from anon, authenticated;
grant select, insert, update, delete on public.recruitment_documents to authenticated;
drop policy if exists "recruitment documents: recruiters" on public.recruitment_documents;
create policy "recruitment documents: recruiters" on public.recruitment_documents for all to authenticated
  using (public.can_manage_recruitment()) with check (public.can_manage_recruitment());

-- The files: a PRIVATE bucket. They open only through short-lived links made for a signed-in recruiter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recruitment', 'recruitment', false, 15728640, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 15728640,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recruitment files: read"   on storage.objects;
drop policy if exists "recruitment files: add"    on storage.objects;
drop policy if exists "recruitment files: change" on storage.objects;
drop policy if exists "recruitment files: delete" on storage.objects;
create policy "recruitment files: read"   on storage.objects for select to authenticated using (bucket_id = 'recruitment' and public.can_manage_recruitment());
create policy "recruitment files: add"    on storage.objects for insert to authenticated with check (bucket_id = 'recruitment' and public.can_manage_recruitment());
create policy "recruitment files: change" on storage.objects for update to authenticated using (bucket_id = 'recruitment' and public.can_manage_recruitment());
create policy "recruitment files: delete" on storage.objects for delete to authenticated using (bucket_id = 'recruitment' and public.can_manage_recruitment());

-- ---------------------------------------------------------------------------
-- 3. Applicant tracking
-- ---------------------------------------------------------------------------
create sequence if not exists public.applicant_ref_seq;

create table if not exists public.applicants (
  id                 uuid primary key default gen_random_uuid(),
  reference          text unique,
  full_name          text not null check (length(btrim(full_name)) between 1 and 120),
  position_title     text not null default '' check (length(position_title) <= 120),
  vacancy_id         uuid references public.vacancies (id) on delete set null,
  received_on        date not null default ((now() at time zone 'Asia/Manila')::date),
  status             text not null default 'new' check (status in
                       ('new', 'screening', 'shortlisted', 'interview', 'work_sample', 'final_review', 'selected', 'not_selected', 'placed', 'withdrawn')),
  source             text not null default 'manual' check (source in ('manual', 'import')),
  status_changed_at  timestamptz not null default now(),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists applicants_status_idx on public.applicants (status, received_on desc);
alter table public.applicants enable row level security;

-- Applicant history: status changes and internal notes. Written only by the two functions below, so a
-- history entry can never be forged or edited from the browser.
create table if not exists public.applicant_events (
  id           uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.applicants (id) on delete cascade,
  kind         text not null check (kind in ('created', 'status', 'note')),
  from_status  text,
  to_status    text,
  note         text not null default '' check (length(note) <= 2000),
  by_id        uuid,
  by_name      text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists applicant_events_idx on public.applicant_events (applicant_id, created_at);
alter table public.applicant_events enable row level security;

create or replace function public.applicants_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
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
    new.status := old.status;                       -- a status changes only through applicant_set_status()
    new.status_changed_at := old.status_changed_at;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.applicants_stamp() from public, anon, authenticated;
drop trigger if exists applicants_stamp_trigger on public.applicants;
create trigger applicants_stamp_trigger before insert or update on public.applicants
  for each row execute function public.applicants_stamp();

create or replace function public.applicants_first_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
  insert into public.applicant_events (applicant_id, kind, to_status, by_id, by_name)
  values (new.id, 'created', new.status, auth.uid(), coalesce(nullif(btrim(p.full_name), ''), p.email, ''));
  return new;
end;
$$;
revoke all on function public.applicants_first_event() from public, anon, authenticated;
drop trigger if exists applicants_first_event_trigger on public.applicants;
create trigger applicants_first_event_trigger after insert on public.applicants
  for each row execute function public.applicants_first_event();

-- Change a status and write the history entry together.
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
  update public.applicants set status = p_status, status_changed_at = now(), updated_at = now() where id = p_id;
  select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
  insert into public.applicant_events (applicant_id, kind, from_status, to_status, note, by_id, by_name)
  values (p_id, 'status', old_status, p_status, left(coalesce(p_note, ''), 2000), auth.uid(), coalesce(nullif(btrim(p.full_name), ''), p.email, ''));
end;
$$;

-- Add an internal note to an applicant.
create or replace function public.applicant_add_note(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.can_manage_recruitment() then raise exception 'Not allowed.'; end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Write a note first.'; end if;
  if not exists (select 1 from public.applicants where id = p_id) then raise exception 'Applicant not found.'; end if;
  select pr.full_name, pr.email into p from public.profiles pr where pr.id = auth.uid();
  insert into public.applicant_events (applicant_id, kind, note, by_id, by_name)
  values (p_id, 'note', left(btrim(p_note), 2000), auth.uid(), coalesce(nullif(btrim(p.full_name), ''), p.email, ''));
  update public.applicants set updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.applicant_set_status(uuid, text, text) from public, anon;
revoke all on function public.applicant_add_note(uuid, text) from public, anon;
grant execute on function public.applicant_set_status(uuid, text, text) to authenticated;
grant execute on function public.applicant_add_note(uuid, text) to authenticated;

revoke all on public.applicants from anon, authenticated;
revoke all on public.applicant_events from anon, authenticated;
grant select, delete on public.applicants to authenticated;
grant insert (reference, full_name, position_title, vacancy_id, received_on, status, source) on public.applicants to authenticated;
grant update (full_name, position_title, vacancy_id, received_on) on public.applicants to authenticated;
grant select on public.applicant_events to authenticated;

drop policy if exists "applicants: recruiters" on public.applicants;
create policy "applicants: recruiters" on public.applicants for all to authenticated
  using (public.can_manage_recruitment()) with check (public.can_manage_recruitment());
drop policy if exists "applicant events: recruiters read" on public.applicant_events;
create policy "applicant events: recruiters read" on public.applicant_events for select to authenticated
  using (public.can_manage_recruitment());
