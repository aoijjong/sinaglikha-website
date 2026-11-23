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
