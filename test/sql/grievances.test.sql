-- Test users (see stub.sql): Legal 1111…, another department 2222…, administrator 3333…; employee aaaa….
-- Behaviour tests for supabase/grievances.sql. Needs test/sql/stub.sql (a stand-in for Supabase's own pieces) and
-- grievances.sql loaded first. Run with scripts/test-sql.sh. Any failed check stops the run with a message.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what using errcode = 'P0099'; end if;
  raise notice 'ok: %', what;
end $$;

-- 1. tickets, constraints (done as the website's server would: with the secret key, so no role is set)
do $$
declare a text; b text; yr text := to_char(now() at time zone 'Asia/Manila', 'YYYY');
begin
  insert into public.grievances (category, subject, body, confidentiality, employee_id)
    values ('pay_benefits', 'Overtime', 'Unpaid overtime', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) returning ticket_no into a;
  insert into public.grievances (category, subject, body, confidentiality, code_hash)
    values ('harassment', 'Comments', 'Unwelcome comments', 'anonymous', 'hash') returning ticket_no into b;
  perform pg_temp.check(a = 'GRV-' || yr || '-0001', 'first ticket is GRV-' || yr || '-0001 (got ' || a || ')');
  perform pg_temp.check(b = 'GRV-' || yr || '-0002', 'second ticket follows (got ' || b || ')');

  begin
    insert into public.grievances (category, subject, body, confidentiality, employee_id, code_hash)
      values ('other', 's', 'b', 'anonymous', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'h');
    perform pg_temp.check(false, 'an anonymous grievance cannot store an employee');
  exception when check_violation then perform pg_temp.check(true, 'an anonymous grievance cannot store an employee'); end;
  begin
    insert into public.grievances (category, subject, body, confidentiality) values ('other', 's', 'b', 'confidential');
    perform pg_temp.check(false, 'a confidential grievance must name the employee');
  exception when check_violation then perform pg_temp.check(true, 'a confidential grievance must name the employee'); end;
  begin
    insert into public.grievances (category, subject, body, confidentiality, employee_id) values ('nonsense', 's', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
    perform pg_temp.check(false, 'unknown category refused');
  exception when check_violation then perform pg_temp.check(true, 'unknown category refused'); end;
  begin
    update public.grievances set ticket_no = 'GRV-1999-0001' where ticket_no = a;
    perform pg_temp.check(false, 'a ticket number cannot be changed');
  exception when raise_exception then perform pg_temp.check(true, 'a ticket number cannot be changed'); end;

  -- the counter never reuses or truncates: past 9999 the number just gets longer
  update public.grievance_counter set last = 9999 where year = yr::int;
  insert into public.grievances (category, subject, body, confidentiality, employee_id)
    values ('other', 'Big', 'Big', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) returning ticket_no into a;
  perform pg_temp.check(a = 'GRV-' || yr || '-10000', 'numbers past 9999 are not cut short (got ' || a || ')');
end $$;

-- 2. nobody but handlers gets in, and the tables cannot be read directly
do $$
declare gid uuid;
begin
  select id into gid from public.grievances limit 1;     -- looked up before the role changes: managers cannot read the table
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);     -- a Rewards Senior Manager
  begin perform * from public.grievance_list(); perform pg_temp.check(false, 'another department cannot list');
  exception when raise_exception then perform pg_temp.check(true, 'another department cannot list'); end;
  begin perform public.grievance_open(gid); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'another department cannot open a case'); end;
  begin perform count(*) from public.grievances; perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'the table cannot be read directly by a signed-in manager'); end;
  begin perform count(*) from public.grievance_messages; perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'messages cannot be read directly'); end;
  perform set_config('role', 'anon', true);
  begin perform * from public.grievance_list(); perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'signed-out visitors cannot call the functions'); end;
end $$;

-- 3. what a Legal Compliance manager can do
do $$
declare g_conf uuid; g_anon uuid; n int; j jsonb; r record; t text; audits int;
begin
  select id into g_conf from public.grievances where confidentiality = 'confidential' and subject = 'Overtime';
  select id into g_anon from public.grievances where confidentiality = 'anonymous';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

  select count(*) into n from public.grievance_list();
  perform pg_temp.check(n >= 3, 'Legal sees the inbox (' || n || ' cases)');

  j := public.grievance_open(g_conf);
  perform pg_temp.check(j->'grievance'->>'ticket_no' like 'GRV-%', 'case opens with its ticket');
  perform pg_temp.check(not (j->'grievance' ? 'employee_id') and not (j->'grievance' ? 'code_hash'), 'the opened case carries no employee id and no code');
  perform pg_temp.check(position('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' in j::text) = 0, 'the employee id appears nowhere in the opened case');

  -- status rules
  begin perform public.grievance_set_status(g_conf, 'closed'); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'cannot close without an outcome'); end;
  begin perform public.grievance_set_status(g_conf, 'bogus'); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'unknown status refused'); end;
  perform public.grievance_set_status(g_conf, 'acknowledged');
  select * into r from public.grievance_list() where id = g_conf;
  perform pg_temp.check(r.status = 'acknowledged' and r.assigned_name = 'Lea Legal', 'acknowledging assigns the case to the handler');
  perform public.grievance_set_status(g_conf, 'closed', 'Paid in full on the next payroll.');
  j := public.grievance_open(g_conf);
  perform pg_temp.check(j->'grievance'->>'status' = 'closed' and j->'grievance'->>'closed_at' is not null and j->'grievance'->>'acknowledged_at' is not null, 'closing stamps the times');
  perform public.grievance_set_status(g_conf, 'under_review');
  j := public.grievance_open(g_conf);
  perform pg_temp.check(j->'grievance'->>'closed_at' is null, 'reopening clears the closed time');

  -- messages
  perform public.grievance_reply(g_conf, 'We are looking into this.', false);
  perform public.grievance_reply(g_conf, 'Check payroll file for March.', true);
  j := public.grievance_open(g_conf);
  perform pg_temp.check((select count(*) from jsonb_array_elements(j->'messages') m where m->>'kind' = 'legal') = 1, 'a reply is a legal message');
  perform pg_temp.check((select count(*) from jsonb_array_elements(j->'messages') m where m->>'kind' = 'note') = 1, 'a private note is kept as a note');

  -- reveal
  select * into r from public.grievance_reveal(g_conf);
  perform pg_temp.check(r.employee_no = 'SNG-0001' and r.full_name = 'Maria Santos' and r.job_title = 'Analyst', 'a confidential grievance can be revealed');
  begin perform * from public.grievance_reveal(g_anon); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'an anonymous grievance has nobody to reveal'); end;

  -- the activity log: only ticket numbers, never the employee; opening is not written there
  perform set_config('role', 'postgres', true);
  select ticket_no into t from public.grievances where id = g_conf;
  select count(*) into audits from public.audit_log where target = t and action like 'grievance.%';
  perform pg_temp.check(audits >= 5, 'status changes, replies and the reveal reach the activity log (' || audits || ' rows)');
  perform pg_temp.check(exists (select 1 from public.audit_log where action = 'grievance.reveal' and target = t and actor_email = 'legal@x.test'), 'the reveal is logged with who asked');
  perform pg_temp.check(not exists (select 1 from public.audit_log where action = 'grievance.open'), 'plain opens stay in the case trail only');
  perform pg_temp.check(not exists (select 1 from public.audit_log where detail::text like '%' || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' || '%' or target like '%SNG-0001%' or actor_email like '%SNG-0001%'), 'the activity log never holds the employee');
  perform pg_temp.check((select count(*) from public.grievance_events where grievance_id = g_conf and kind = 'open') >= 3, 'each open is kept in the case trail');
end $$;

-- 4. the administrator can handle cases too; updated_at behaves
do $$
declare g uuid; before_t timestamptz; after_t timestamptz;
begin
  select id into g from public.grievances where confidentiality = 'anonymous';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  perform public.grievance_take(g);
  perform pg_temp.check((select assigned_name from public.grievance_list() where id = g) = 'Ada Admin', 'the administrator can take a case');

  perform set_config('role', 'postgres', true);
  update public.grievances set updated_at = '2026-01-05 00:00+08' where id = g;
  select updated_at into before_t from public.grievances where id = g;
  perform pg_temp.check(before_t = '2026-01-05 00:00+08', 'an update can set updated_at itself (anonymous cases keep it rounded)');
  update public.grievances set outcome = 'x' where id = g;
  select updated_at into after_t from public.grievances where id = g;
  perform pg_temp.check(after_t > before_t, 'an ordinary update moves updated_at');
end $$;

-- 5. a deliverable card was added for the Content tab
select pg_temp.check(exists (select 1 from public.deliverables where key = 'grievances' and department = 'legal' and kind = 'special'), 'the Grievances card exists on the Legal page');

-- ===========================================================================
-- 6. Routing: a case that involves Legal goes to the Administrator only, and the other way round; recusing
-- ===========================================================================
do $$
declare g_adm uuid; g_leg uuid; g_r uuid; n int; j jsonb; r record;
begin
  insert into public.grievances (category, subject, body, confidentiality, employee_id, routing)
    values ('supervisor', 'ROUTE involves Legal', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin_only') returning id into g_adm;
  insert into public.grievances (category, subject, body, confidentiality, employee_id, routing)
    values ('supervisor', 'ROUTE involves Admin', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legal_only') returning id into g_leg;
  insert into public.grievances (category, subject, body, confidentiality, employee_id, assigned_to)
    values ('policy', 'RECUSE me', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111') returning id into g_r;
  begin
    insert into public.grievances (category, subject, body, confidentiality, employee_id, routing)
      values ('policy', 's', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'everyone');
    perform pg_temp.check(false, 'x');
  exception when check_violation then perform pg_temp.check(true, 'an unknown routing is refused'); end;

  -- Legal Compliance
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform pg_temp.check(not exists (select 1 from public.grievance_list() where subject = 'ROUTE involves Legal'), 'a case involving Legal is hidden from Legal Compliance');
  perform pg_temp.check(exists (select 1 from public.grievance_list() where subject = 'ROUTE involves Admin'), 'a case involving the Administrator is shown to Legal Compliance');
  begin perform public.grievance_open(g_adm); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'Legal cannot open a case that involves Legal'); end;
  begin perform public.grievance_reply(g_adm, 'hello', false); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'Legal cannot act on a case that involves Legal'); end;
  begin perform * from public.grievance_reveal(g_adm); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'Legal cannot reveal who raised a case that involves Legal'); end;

  -- the Administrator
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  perform pg_temp.check(exists (select 1 from public.grievance_list() where subject = 'ROUTE involves Legal'), 'a case involving Legal is shown to the Administrator');
  perform pg_temp.check(not exists (select 1 from public.grievance_list() where subject = 'ROUTE involves Admin'), 'a case involving the Administrator is hidden from the Administrator');
  begin perform public.grievance_open(g_leg); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'the Administrator cannot open a case that involves them'); end;

  -- another department sees none of them
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  begin perform * from public.grievance_list(); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'another department still cannot list anything'); end;

  -- recusing
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform pg_temp.check(exists (select 1 from public.grievance_list() where id = g_r and assigned_name = 'Lea Legal'), 'a case assigned to Legal is shown to Legal');
  perform public.grievance_recuse(g_r);
  perform pg_temp.check(not exists (select 1 from public.grievance_list() where id = g_r), 'after recusing, the case is gone from the handler''s inbox');
  begin perform public.grievance_open(g_r); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'after recusing, the handler cannot open it'); end;
  begin perform public.grievance_recuse(g_r); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'recusing twice is refused (the case is no longer theirs to see)'); end;
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  select * into r from public.grievance_list() where id = g_r;
  perform pg_temp.check(r.id is not null and r.assigned_to is null, 'someone else still sees it, and it is unassigned');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check(exists (select 1 from public.grievance_events where grievance_id = g_r and kind = 'recuse'), 'the recusal is in the case trail');
  perform pg_temp.check(exists (select 1 from public.audit_log where action = 'grievance.recuse' and actor_email = 'legal@x.test'), 'the recusal is in the activity log');
end $$;

-- ===========================================================================
-- 7. Time limits
-- ===========================================================================
do $$
declare d text; ids uuid[] := '{}'; id1 uuid; j jsonb; r record; l record;
begin
  -- working days: Monday to Friday on the Philippine calendar
  perform pg_temp.check(public.grievance_workdays('2026-11-20 10:00+08', '2026-11-23 10:00+08') = 1, 'Friday to Monday is 1 working day');
  perform pg_temp.check(public.grievance_workdays('2026-11-23 10:00+08', '2026-11-27 10:00+08') = 4, 'Monday to Friday is 4 working days');
  perform pg_temp.check(public.grievance_workdays('2026-11-20 10:00+08', '2026-11-27 10:00+08') = 5, 'a whole week is 5 working days');
  perform pg_temp.check(public.grievance_workdays('2026-11-23 09:00+08', '2026-11-23 17:00+08') = 0, 'the same day is 0');
  perform pg_temp.check(public.grievance_workdays('2026-11-20 10:00+08', '2026-11-22 10:00+08') = 0, 'Friday to Sunday is 0 (a weekend)');
  perform pg_temp.check(public.grievance_workdays('2026-11-23 10:00+08', '2026-11-20 10:00+08') = 0, 'backwards is 0');
  perform pg_temp.check(public.grievance_workdays('2026-11-20 23:30+08', '2026-11-21 00:30+08') = 0 and public.grievance_workdays('2026-11-22 23:30+08', '2026-11-23 00:30+08') = 1, 'the Philippine midnight is the boundary, not UTC');

  insert into public.grievances (category, subject, body, confidentiality, employee_id, status, created_at, updated_at) values
    ('other', 'DUE new', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'submitted', now(), now()),
    ('other', 'DUE unacknowledged', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'submitted', now() - interval '10 days', now() - interval '10 days'),
    ('other', 'DUE stale', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'under_review', now() - interval '12 days', now() - interval '10 days'),
    ('other', 'DUE recent update', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'under_review', now() - interval '12 days', now()),
    ('other', 'DUE target', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'escalated', now() - interval '40 days', now()),
    ('other', 'DUE resolved', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'resolved', now() - interval '100 days', now() - interval '100 days'),
    ('other', 'DUE closed', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'closed', now() - interval '100 days', now() - interval '100 days');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE new';              perform pg_temp.check(d is null, 'a new grievance is not overdue');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE unacknowledged';   perform pg_temp.check(d = 'Not acknowledged within 2 working days', 'unacknowledged for days is overdue (' || coalesce(d, 'null') || ')');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE stale';            perform pg_temp.check(d = 'No update for more than 5 working days', 'no update for 10 days is overdue (' || coalesce(d, 'null') || ')');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE recent update';    perform pg_temp.check(d is null, 'a recently updated case is not overdue');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE target';           perform pg_temp.check(d = 'Past the 30-day resolution target', 'past the target is overdue (' || coalesce(d, 'null') || ')');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE resolved';         perform pg_temp.check(d is null, 'a resolved case is never overdue');
  select public.grievance_due(g) into d from public.grievances g where subject = 'DUE closed';           perform pg_temp.check(d is null, 'a closed case is never overdue');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  select * into l from public.grievance_list() where subject = 'DUE stale';
  perform pg_temp.check(l.overdue = 'No update for more than 5 working days', 'the inbox carries the overdue reason');
  j := public.grievance_open(l.id);
  perform pg_temp.check(j->'grievance'->>'overdue' = 'No update for more than 5 working days', 'the opened case carries it too');
  j := public.grievance_counts();
  perform pg_temp.check((j->>'overdue')::int >= 3 and (j->>'attention')::int >= 2 and (j->>'open')::int >= 5, 'the dashboard counts add up (' || j::text || ')');
  begin perform public.grievance_due((select g from public.grievances g limit 1)); perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'the overdue helper is not callable from a browser'); end;
end $$;

-- ===========================================================================
-- 8. Settings: only the Administrator changes them, and bad values are refused
-- ===========================================================================
do $$
declare j jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  j := public.grievance_get_settings();
  perform pg_temp.check((j->>'ack_days')::int = 2 and (j->>'update_days')::int = 5 and (j->>'resolve_days')::int = 30 and j->>'retention_months' is null and not (j ? 'id'), 'defaults: 2 / 5 / 30 days, nothing deleted');
  begin perform public.grievance_set_settings(1, 1, 1, null); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'Legal Compliance cannot change the settings'); end;
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  begin perform public.grievance_set_settings(0, 5, 30, null); perform pg_temp.check(false, 'x');
  exception when check_violation then perform pg_temp.check(true, 'zero days is refused'); end;
  begin perform public.grievance_set_settings(2, 5, 30, 0); perform pg_temp.check(false, 'x');
  exception when check_violation then perform pg_temp.check(true, 'a retention of 0 months is refused'); end;
  perform public.grievance_set_settings(1, 5, 30, null);
  perform pg_temp.check((public.grievance_get_settings()->>'ack_days')::int = 1, 'the Administrator can change them');
  perform public.grievance_set_settings(2, 5, 30, null);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check(exists (select 1 from public.audit_log where action = 'grievance.settings' and actor_email = 'admin@x.test'), 'a change is in the activity log');
end $$;

-- ===========================================================================
-- 9. Files, and who may open them
-- ===========================================================================
do $$
declare g_ok uuid; g_adm uuid; j jsonb; rc int;
begin
  select id into g_ok  from public.grievances where subject = 'DUE new';
  select id into g_adm from public.grievances where subject = 'ROUTE involves Legal';
  insert into public.grievance_files (grievance_id, path, name, size_bytes, mime, confirmed) values
    (g_ok,  'f/ok-confirmed.pdf',   'Payslip.pdf', 1000, 'application/pdf', true),
    (g_ok,  'f/ok-unconfirmed.pdf', 'Half.pdf',    1000, 'application/pdf', false),
    (g_adm, 'f/adm-confirmed.pdf',  'Secret.pdf',  1000, 'application/pdf', true);
  insert into storage.objects (bucket_id, name) values ('grievances', 'f/ok-confirmed.pdf'), ('grievances', 'f/ok-unconfirmed.pdf'),
    ('grievances', 'f/adm-confirmed.pdf'), ('other', 'f/ok-confirmed.pdf');
  begin
    insert into public.grievance_files (grievance_id, path, name, size_bytes, mime) values (g_ok, 'f/big.pdf', 'Big.pdf', 99999999, 'application/pdf');
    perform pg_temp.check(false, 'x');
  exception when check_violation then perform pg_temp.check(true, 'a file over 10 MB is refused'); end;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);   -- Legal
  perform pg_temp.check(public.grievance_file_visible('f/ok-confirmed.pdf'), 'Legal can open a confirmed file of a case they may see');
  perform pg_temp.check(not public.grievance_file_visible('f/ok-unconfirmed.pdf'), 'an unconfirmed upload is not shown');
  perform pg_temp.check(not public.grievance_file_visible('f/adm-confirmed.pdf'), 'a file of a case hidden from Legal is not shown');
  perform pg_temp.check((select count(*) from storage.objects) = 1, 'the storage rules let Legal see exactly one object (' || (select count(*) from storage.objects) || ')');
  j := public.grievance_open(g_ok);
  perform pg_temp.check(jsonb_array_length(j->'files') = 1 and j->'files'->0->>'name' = 'Payslip.pdf', 'the opened case lists only confirmed files');
  perform pg_temp.check((select file_count from public.grievance_list() where id = g_ok) = 1, 'the inbox counts confirmed files');
  delete from storage.objects where bucket_id = 'grievances'; get diagnostics rc = row_count;
  perform pg_temp.check(rc = 0, 'Legal cannot delete files');

  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);   -- Administrator
  perform pg_temp.check(public.grievance_file_visible('f/adm-confirmed.pdf'), 'the Administrator can open the file of a case involving Legal');
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);   -- another department
  perform pg_temp.check(not public.grievance_file_visible('f/ok-confirmed.pdf') and (select count(*) from storage.objects) = 0, 'another department sees no files');
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  delete from storage.objects where bucket_id = 'grievances'; get diagnostics rc = row_count;
  perform pg_temp.check(rc = 2, 'the Administrator can delete the files of cases they may see (' || rc || ' removed; an unconfirmed upload is not theirs to see)');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check((select count(*) from storage.objects where bucket_id = 'other') = 1, 'and only that bucket');

  -- once no record points to a file any more (after a purge) it becomes a leftover that only the Administrator can remove
  delete from public.grievance_files where path = 'f/ok-unconfirmed.pdf';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform pg_temp.check(not public.grievance_file_visible('f/ok-unconfirmed.pdf'), 'Legal cannot see a leftover file');
  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  perform pg_temp.check(public.grievance_file_visible('f/ok-unconfirmed.pdf'), 'the Administrator sees a leftover file');
  delete from storage.objects where bucket_id = 'grievances'; get diagnostics rc = row_count;
  perform pg_temp.check(rc = 1, 'and can remove it (' || rc || ' removed)');
  perform set_config('role', 'postgres', true);
end $$;

-- ===========================================================================
-- 10. Retention: nothing is deleted until the Administrator sets a period and presses the button
-- ===========================================================================
do $$
declare j jsonb; n_before int; n_after int;
begin
  insert into public.grievances (category, subject, body, confidentiality, employee_id, status, closed_at, created_at, updated_at) values
    ('other', 'PURGE old closed',    'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'closed', now() - interval '3 months', now() - interval '5 months', now() - interval '3 months'),
    ('other', 'PURGE recent closed', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'closed', now(),                      now() - interval '1 month',  now()),
    ('other', 'PURGE old open',      'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'under_review', null,                 now() - interval '5 months', now() - interval '5 months');
  insert into public.grievance_messages (grievance_id, author_kind, body) select id, 'employee', 'hello' from public.grievances where subject = 'PURGE old closed';
  insert into public.grievance_files (grievance_id, path, name, size_bytes, mime, confirmed)
    select id, 'f/purge-old.pdf', 'Old.pdf', 10, 'application/pdf', true from public.grievances where subject = 'PURGE old closed';
  insert into public.grievance_files (grievance_id, path, name, size_bytes, mime, confirmed, created_at)
    select id, 'f/purge-halfway.pdf', 'Half.pdf', 10, 'application/pdf', false, now() - interval '3 days' from public.grievances where subject = 'PURGE recent closed';
  insert into public.grievance_files (grievance_id, path, name, size_bytes, mime, confirmed)
    select id, 'f/purge-fresh-halfway.pdf', 'Fresh.pdf', 10, 'application/pdf', false from public.grievances where subject = 'PURGE recent closed';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin perform public.grievance_purge_preview(); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'Legal Compliance cannot even preview a purge'); end;
  -- with a retention period set, so that a missing permission check would really delete something
  perform set_config('role', 'postgres', true);
  update public.grievance_settings set retention_months = 2 where id = 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin perform public.grievance_purge(); perform pg_temp.check(false, 'a purge by Legal Compliance must not run');
  exception when raise_exception then perform pg_temp.check(sqlerrm like '%Only the Administrator%', 'Legal Compliance cannot purge (refused for permission: ' || sqlerrm || ')'); end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.check(exists (select 1 from public.grievances where subject = 'PURGE old closed'), 'and nothing was deleted');
  update public.grievance_settings set retention_months = null where id = 1;
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  j := public.grievance_purge_preview();
  perform pg_temp.check(j->>'retention_months' is null and (j->>'eligible')::int = 0, 'with no retention period, nothing is eligible');
  begin perform public.grievance_purge(); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'purging with no retention period is refused'); end;
  select count(*) into n_before from (select 1 from public.grievance_list()) x;

  perform public.grievance_set_settings(2, 5, 30, 2);
  j := public.grievance_purge_preview();
  perform pg_temp.check((j->>'eligible')::int = 1, 'one closed case is past 2 months (' || j::text || ')');
  j := public.grievance_purge();
  perform pg_temp.check((j->>'deleted')::int = 1, 'the purge deleted that one case');
  perform pg_temp.check(j->'paths' @> '"f/purge-old.pdf"'::jsonb and j->'paths' @> '"f/purge-halfway.pdf"'::jsonb, 'it returns the case''s file and the stale half-finished upload');
  perform pg_temp.check(not (j->'paths' @> '"f/purge-fresh-halfway.pdf"'::jsonb), 'a fresh half-finished upload is left alone');
  select count(*) into n_after from (select 1 from public.grievance_list()) x;
  perform pg_temp.check(n_after = n_before - 1, 'only that case is gone from the inbox');
  perform pg_temp.check((select count(*) from public.grievance_list() where subject in ('PURGE recent closed', 'PURGE old open')) = 2, 'a recent closed case and an old open case are both kept');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check(not exists (select 1 from public.grievance_messages m where m.body = 'hello' and not exists (select 1 from public.grievances g where g.id = m.grievance_id)), 'its messages went with it');
  perform pg_temp.check(exists (select 1 from public.audit_log where action = 'grievance.purge' and detail->>'deleted' = '1' and target is null), 'the purge is logged with a count and no names');
  update public.grievance_settings set retention_months = null where id = 1;
end $$;

-- ===========================================================================
-- 11. Statistics and the daily summary
-- ===========================================================================
do $$
declare j jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  j := public.grievance_stats();
  perform pg_temp.check((j->>'total')::int > 0 and (j->>'open')::int <= (j->>'total')::int and (j->'by_status') ? 'closed' and (j->'by_category') ? 'other' and jsonb_typeof(j->'by_month') = 'array', 'statistics have the expected shape');
  perform pg_temp.check((select sum(v::int) from jsonb_each_text(j->'by_status') as e(k, v)) = (j->>'total')::int, 'the status counts add up to the total');
  perform pg_temp.check(j::text !~* '(SNG-0001|Maria|aaaaaaaa|Lea Legal|employee_id)', 'statistics hold no names or ids');
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  begin perform public.grievance_stats(); perform pg_temp.check(false, 'x');
  exception when raise_exception then perform pg_temp.check(true, 'another department cannot read statistics'); end;
  begin perform public.grievance_digest(); perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'the daily summary cannot be called from a browser'); end;
  perform set_config('role', 'anon', true);
  begin perform public.grievance_counts(); perform pg_temp.check(false, 'x');
  exception when insufficient_privilege then perform pg_temp.check(true, 'signed-out visitors cannot call the counters'); end;
  perform set_config('role', 'postgres', true);
  j := public.grievance_digest();
  perform pg_temp.check((j->'admin'->>'overdue')::int >= 1 and (j->'legal'->>'unacknowledged')::int >= 1, 'the daily summary counts (' || j::text || ')');
  perform pg_temp.check(j::text !~* '(GRV-|SNG-|Maria|aaaaaaaa)', 'the daily summary carries no ticket numbers or names');
  insert into public.grievances (category, subject, body, confidentiality, employee_id, routing)
    values ('other', 'DIGEST admin only', 'b', 'confidential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin_only');
  perform pg_temp.check((public.grievance_digest()->'admin'->>'unacknowledged')::int = (j->'admin'->>'unacknowledged')::int + 1
                    and (public.grievance_digest()->'legal'->>'unacknowledged')::int = (j->'legal'->>'unacknowledged')::int,
                    'an admin-only case is counted for the Administrator and not for Legal Compliance');
end $$;
