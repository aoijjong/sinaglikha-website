do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create table public.profiles (id uuid primary key, email text, full_name text not null default '', role text not null default 'senior_manager', active boolean not null default true, department text);
create table public.employees (id uuid primary key default gen_random_uuid(), employee_no text, full_name text, position text);
create table public.audit_log (id bigint generated always as identity primary key, at timestamptz not null default now(), actor uuid, actor_email text, actor_department text, action text not null, target text, detail jsonb);
create table public.deliverables (key text primary key, name text not null, department text not null, kind text not null, allow_public boolean not null default false);
insert into public.profiles (id,email,full_name,role,department) values
 ('11111111-1111-4111-8111-111111111111','legal@x.test','Lea Legal','senior_manager','legal'),
 ('22222222-2222-4222-8222-222222222222','rewards@x.test','Rey Rewards','senior_manager','rewards'),
 ('33333333-3333-4333-8333-333333333333','admin@x.test','Ada Admin','admin',null);
insert into public.employees (id, employee_no, full_name, position) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SNG-0001','Maria Santos','Analyst');
-- a stand-in for Supabase Storage, enough for the bucket and its access rules
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, delete on storage.objects to authenticated;
