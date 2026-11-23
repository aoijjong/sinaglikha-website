const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { E, evaluate, ME, OTHER, DAY, FORM, fakeDb, call } = require('./_grievance-fake.js');
const M = require('../assets/grievance-meta.js');

test('before the SQL has been run the panel stays hidden and nothing breaks', async () => {
  fakeDb({ missing: true });
  const r = await call('GET', {});
  assert.deepEqual([r.status, r.data.available, r.data.mine], [200, false, []]);
  assert.equal((await call('POST', {}, FORM)).status, 503);
});

test('a confidential grievance records the employee, returns a ticket, and logs only the ticket', async () => {
  const db = fakeDb();
  const r = await call('POST', {}, FORM);
  assert.equal(r.status, 200);
  assert.match(r.data.ticket_no, M.TICKET_RE);
  assert.equal(r.data.access_code, null);
  const g = db.grievances[0];
  assert.equal(g.employee_id, ME);
  assert.equal(g.confidentiality, 'confidential');
  assert.ok(!('code_hash' in g));
  const audit = db.audit_log[0];
  assert.equal(audit.action, 'grievance.submit');
  assert.equal(audit.target, r.data.ticket_no);
  assert.ok(!JSON.stringify(audit).includes(ME) && !JSON.stringify(audit).includes('SNG-0001'), 'the activity log never names the employee');
  const mine = (await call('GET', {})).data;
  assert.equal(mine.available, true);
  assert.deepEqual(Object.keys(mine.mine[0]).sort(), ['category', 'created_at', 'id', 'status', 'subject', 'ticket_no'], 'only safe columns are listed');
});

test('an anonymous grievance stores no employee, rounds its time to the day, and writes nothing to the activity log', async () => {
  const db = fakeDb();
  const r = await call('POST', {}, Object.assign({ anonymous: true }, FORM));
  assert.equal(r.status, 200);
  assert.match(r.data.access_code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const g = db.grievances[0];
  assert.ok(!('employee_id' in g) && g.confidentiality === 'anonymous');
  assert.notEqual(g.code_hash, r.data.access_code);
  assert.ok(!JSON.stringify(g).includes(ME));
  assert.equal(g.created_at, DAY);
  assert.equal(g.updated_at, DAY);
  assert.equal(db.audit_log.length, 0, 'no audit row, so a login time cannot be matched to it');
  assert.equal((await call('GET', {})).data.mine.length, 0, 'it is not in the list of cases linked to this employee');
});

test('an anonymous case opens only with the ticket AND the code; wrong guesses are counted and then blocked', async () => {
  const db = fakeDb();
  const made = (await call('POST', {}, Object.assign({ anonymous: true }, FORM))).data;
  const ok = await call('GET', { ticket: made.ticket_no, code: made.access_code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.case.subject, 'Overtime not paid');
  assert.ok(!JSON.stringify(ok.data).includes('code_hash') && !JSON.stringify(ok.data).includes(made.access_code));
  assert.equal((await call('GET', { ticket: ' ' + made.ticket_no.toLowerCase(), code: made.access_code.toLowerCase().replace('-', ' ') })).status, 200, 'case, spaces and dash do not matter');

  assert.equal((await call('GET', { ticket: made.ticket_no })).status, 404, 'a ticket number alone opens nothing');
  assert.equal((await call('GET', { ticket: made.ticket_no, code: 'ZZZZ-ZZZZ' })).status, 404);
  assert.equal(db.employee_attempts.filter((a) => a.ok === false).length, 1, 'the wrong code was counted');
  assert.equal((await call('GET', { ticket: 'GRV-2026-9999', code: made.access_code })).status, 404, 'unknown ticket looks the same');

  for (let i = 0; i < 25; i++) await call('GET', { ticket: made.ticket_no, code: 'ZZZZ-ZZZZ' });
  assert.equal((await call('GET', { ticket: made.ticket_no, code: made.access_code })).status, 429, 'the device is locked out after many wrong tries');
});

test('a confidential grievance cannot be opened by ticket and code, nor by another employee', async () => {
  fakeDb();
  const made = (await call('POST', {}, FORM)).data;
  const id = (await call('GET', {})).data.mine[0].id;
  assert.equal((await call('GET', { id })).status, 200);
  assert.equal((await call('GET', { id }, undefined, OTHER)).status, 404, 'another employee gets nothing');
  assert.equal((await call('GET', { ticket: made.ticket_no, code: 'ABCD-2345' })).status, 404, 'not reachable as if it were anonymous');
  assert.equal((await call('GET', { id: 'not-a-uuid' })).status, 400);
});

test('the employee sees replies from Legal, never private notes or who wrote them', async () => {
  const db = fakeDb();
  await call('POST', {}, FORM);
  const g = db.grievances[0];
  db.grievance_messages.push(
    { id: 'm1', grievance_id: g.id, author_kind: 'legal', author_id: 'handler-1', body: 'We are looking into it.', created_at: '2026-11-23T01:00:00Z' },
    { id: 'm2', grievance_id: g.id, author_kind: 'note', author_id: 'handler-1', body: 'PRIVATE: check payroll', created_at: '2026-11-23T02:00:00Z' });
  const r = await call('GET', { id: g.id });
  const json = JSON.stringify(r.data);
  assert.ok(!json.includes('PRIVATE') && !json.includes('handler-1'));
  assert.deepEqual(r.data.messages.map((m) => m.from), ['legal']);
  assert.ok(!('employee_id' in r.data.case));
});

test('replies: saved, closed cases refuse them, anonymous replies are rounded to the day', async () => {
  const db = fakeDb();
  await call('POST', {}, FORM);
  const g = db.grievances[0];
  assert.equal((await call('POST', {}, { action: 'reply', id: g.id, body: 'More detail.' })).status, 200);
  assert.deepEqual(db.grievance_messages.map((m) => m.author_kind), ['employee']);
  assert.equal((await call('POST', {}, { action: 'reply', id: g.id, body: '   ' })).status, 400);
  g.status = 'closed';
  assert.equal((await call('POST', {}, { action: 'reply', id: g.id, body: 'Again' })).status, 409);

  const made = (await call('POST', {}, Object.assign({ anonymous: true }, FORM))).data;
  assert.equal((await call('POST', {}, { action: 'reply', ticket: made.ticket_no, code: made.access_code, body: 'Anonymous follow-up' })).status, 200);
  assert.equal(db.grievance_messages.at(-1).created_at, DAY);
  assert.ok(!('author_id' in db.grievance_messages.at(-1)));
  assert.equal((await call('POST', {}, { action: 'reply', ticket: made.ticket_no, code: 'ZZZZ-ZZZZ', body: 'x' })).status, 404);
});

test('the form is checked on the server', async () => {
  fakeDb();
  const bad = async (over, status = 400) => assert.equal((await call('POST', {}, Object.assign({}, FORM, over))).status, status, JSON.stringify(over));
  await bad({ category: 'nonsense' });
  await bad({ category: undefined });
  await bad({ subject: '   ' });
  await bad({ body: '' });
  await bad({ incident_date: '2026-02-31' });
  await bad({ incident_date: '2999-01-01' });
  await bad({ incident_date: 'yesterday' });
  assert.equal((await call('POST', {}, { action: 'what' })).status, 400);
  assert.equal((await call('POST', {}, Object.assign({}, FORM, { incident_date: '' }))).status, 200, 'the date is optional');
});

test('text is trimmed and cut to the limits; anonymous must be exactly true', async () => {
  const db = fakeDb();
  await call('POST', {}, Object.assign({}, FORM, { subject: 'S'.repeat(500), body: 'B'.repeat(9000), location: 'L'.repeat(500), involved: 'I'.repeat(900), anonymous: 'true' }));
  const g = db.grievances[0];
  assert.deepEqual([g.subject.length, g.body.length, g.location.length, g.involved.length], [120, 4000, 120, 300]);
  assert.equal(g.confidentiality, 'confidential', 'the string "true" does not make it anonymous');
});

test('limits: 3 confidential a day each; 30 anonymous a day in all', async () => {
  fakeDb();
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', {}, FORM)).status, 200);
  assert.equal((await call('POST', {}, FORM)).status, 429);
  assert.equal((await call('POST', {}, FORM, OTHER)).status, 200, 'another employee is not affected');
  fakeDb();
  for (let i = 0; i < 30; i++) assert.equal((await call('POST', {}, Object.assign({ anonymous: true }, FORM))).status, 200);
  assert.equal((await call('POST', {}, Object.assign({ anonymous: true }, FORM))).status, 429);
});

test('a request from another website is refused', async () => {
  const db = fakeDb();
  const r = await call('POST', {}, FORM, ME, { origin: 'https://evil.example' });
  assert.equal(r.status, 400);
  assert.equal(db.grievances.length, 0);
});

test('signed-out visitors get nothing', async () => {
  fakeDb();
  const r = await new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    evaluate({ method: 'GET', query: { gr: '1' }, headers: { host: 'x.test' } }, res);
  });
  assert.equal(r.status, 401);
});

test('the lists in the code match the database rules', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'grievances.sql'), 'utf8');
  const listOf = (re) => re.exec(sql)[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(listOf(/category\s+text not null check \(category in \(([^)]*)\)/), M.CATEGORIES.map((c) => c.key).sort());
  assert.deepEqual(listOf(/status\s+text not null default 'submitted' check \(status in \(([^)]*)\)/), M.STATUSES.map((s) => s.key).sort());
  assert.deepEqual(listOf(/p_status not in \(([^)]*)\)/), M.STATUSES.map((s) => s.key).sort());
  assert.match('GRV-2026-0001', M.TICKET_RE);
  assert.match('GRV-2027-12345', M.TICKET_RE);
  assert.doesNotMatch('SNG-0001', M.TICKET_RE);
});
