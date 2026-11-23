const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { E, evaluate, ME, OTHER, DAY, FORM, fakeDb, call, cron } = require('./_grievance-fake.js');
const M = require('../assets/grievance-meta.js');

const mailOn = () => { process.env.RESEND_API_KEY = 're_test_key'; process.env.GRIEVANCE_MAIL_FROM = 'SINAGLIKHA <alerts@example.com>'; };
const mailOff = () => { delete process.env.RESEND_API_KEY; delete process.env.GRIEVANCE_MAIL_FROM; };
const sorted = (a) => a.slice().sort();

/* ---------- who may handle a case ---------- */
test('"does it involve someone in Legal or the Administrator?" decides the routing', async () => {
  const db = fakeDb();
  await call('POST', {}, Object.assign({}, FORM, { involves: 'legal_member' }));
  await call('POST', {}, Object.assign({}, FORM, { involves: 'administrator' }), OTHER);
  await call('POST', {}, Object.assign({}, FORM, { involves: 'none' }));
  await call('POST', {}, Object.assign({}, FORM, { involves: 'something else' }), OTHER);
  await call('POST', {}, FORM, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.deepEqual(db.grievances.map((g) => g.routing), ['admin_only', 'legal_only', 'legal', 'legal', 'legal']);
  assert.deepEqual(M.INVOLVES.map((x) => x.routing), ['legal', 'admin_only', 'legal_only']);
});

/* ---------- attachments ---------- */
async function oneCase(over = {}, who = ME) {
  const db = fakeDb();
  const made = (await call('POST', {}, Object.assign({}, FORM, over), who)).data;
  return { db, made, g: db.grievances[0], who };
}
const reserve = (c, file = {}, extra = {}) => call('POST', {}, Object.assign({ action: 'file_url', id: c.g.id, name: 'Payslip March.pdf', size: 50000, mime: 'application/pdf' }, file, extra), c.who);

test('a file is reserved under a random name, with a one-time upload address', async () => {
  const c = await oneCase();
  const r = await reserve(c);
  assert.equal(r.status, 200);
  assert.match(r.data.upload_url, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/grievances\/.+\?token=/);
  const row = c.db.grievance_files[0];
  assert.equal(row.confirmed, false);
  assert.equal(row.name, 'Payslip March.pdf');
  assert.match(row.path, new RegExp('^' + c.g.id + '/[0-9a-f-]{36}\\.pdf$'));
  assert.ok(!row.path.includes('Payslip'), 'what the employee called the file is not in the stored name');
  assert.ok(r.data.upload_url.includes(encodeURIComponent(row.path.split('/')[1])), 'the address is for that one path');
});

test('only allowed kinds and sizes, at most five, and the name is made safe', async () => {
  const c = await oneCase();
  for (const bad of [{ mime: 'image/svg+xml' }, { mime: 'application/x-msdownload' }, { mime: 'text/html' }, { mime: '' }, { size: 0 }, { size: 11 * 1024 * 1024 }, { size: 1.5 }, { size: 'big' }, { size: -5 }])
    assert.equal((await reserve(c, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await reserve(c, { name: '../../etc/passwd\u0000.pdf' })).status, 200);
  assert.equal(c.db.grievance_files[0].name, '.._.._etc_passwd_.pdf');
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'text/plain']) assert.equal((await reserve(c, { mime })).status, 200, mime);
  assert.equal((await reserve(c)).status, 400, 'a sixth file is refused');
  assert.equal(c.db.grievance_files.length, 5);
});

test('files are only for the person allowed to open the case, and not for closed cases', async () => {
  const c = await oneCase();
  assert.equal((await reserve(c)).status, 200);
  assert.equal((await call('POST', {}, { action: 'file_url', id: c.g.id, name: 'x.pdf', size: 10, mime: 'application/pdf' }, OTHER)).status, 404, 'another employee gets nothing');
  assert.equal((await call('POST', {}, { action: 'file_url', ticket: c.made.ticket_no, code: 'ABCD-2345', name: 'x.pdf', size: 10, mime: 'application/pdf' })).status, 404, 'a confidential case cannot be reached by ticket and code');
  c.g.status = 'closed';
  assert.equal((await reserve(c)).status, 409);
});

test('an upload that did not happen is not confirmed; one that did is, and only then is it listed', async () => {
  const c = await oneCase();
  const r = (await reserve(c)).data;
  const row = c.db.grievance_files[0];
  assert.equal((await call('POST', {}, { action: 'file_done', id: c.g.id, file_id: r.file_id })).status, 404, 'nothing uploaded yet');
  assert.equal(row.confirmed, false);
  assert.deepEqual((await call('GET', { id: c.g.id })).data.files, [], 'an unconfirmed file is not shown');
  c.db.storage.files.add(row.path);
  assert.equal((await call('POST', {}, { action: 'file_done', id: c.g.id, file_id: r.file_id })).status, 200);
  assert.equal(row.confirmed, true);
  assert.equal((await call('POST', {}, { action: 'file_done', id: c.g.id, file_id: r.file_id })).status, 200, 'confirming twice is fine');
  const view = (await call('GET', { id: c.g.id })).data;
  assert.deepEqual(view.files, [{ id: row.id, name: 'Payslip March.pdf', size: 50000 }]);
  assert.ok(!JSON.stringify(view).includes(row.path) && !JSON.stringify(view).includes(row.path.split('/')[1]), 'the stored path is never sent');
  assert.equal((await call('POST', {}, { action: 'file_done', id: c.g.id, file_id: 'nope' })).status, 400);
  assert.equal((await call('POST', {}, { action: 'file_done', id: c.g.id, file_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })).status, 404);
});

test('a failed upload address leaves nothing behind', async () => {
  const c = await oneCase();
  c.db.storage.signFails = true;
  const r = await reserve(c);
  assert.equal(r.status, 502);
  assert.equal(c.db.grievance_files.length, 0, 'the reservation was removed');
  c.db.storage.signFails = false;
  assert.equal((await reserve(c)).status, 200, 'and it can be tried again');
});

test('an unfinished upload from an earlier day does not use up one of the five', async () => {
  const c = await oneCase();
  for (let i = 0; i < 5; i++) c.db.grievance_files.push({ id: 'f' + i, grievance_id: c.g.id, confirmed: false, created_at: '2020-01-01T00:00:00.000Z', path: 'x' + i });
  assert.equal((await reserve(c)).status, 200);
});

test('anonymous cases take files too, with the day-rounded time and only by ticket AND code', async () => {
  const c = await oneCase({ anonymous: true });
  const body = { name: 'Evidence.pdf', size: 1000, mime: 'application/pdf' };
  assert.equal((await call('POST', {}, Object.assign({ action: 'file_url', ticket: c.made.ticket_no, code: 'ZZZZ-ZZZZ' }, body))).status, 404);
  assert.equal((await call('POST', {}, Object.assign({ action: 'file_url', ticket: c.made.ticket_no }, body))).status, 404, 'a ticket alone is not enough');
  const r = await call('POST', {}, Object.assign({ action: 'file_url', ticket: c.made.ticket_no, code: c.made.access_code }, body));
  assert.equal(r.status, 200);
  assert.equal(c.db.grievance_files[0].created_at, DAY);
  assert.ok(!JSON.stringify(c.db.grievance_files[0]).includes(ME), 'no employee is recorded with the file');
});

/* ---------- email alerts ---------- */
test('with no email service set up, nothing is sent and nothing breaks', async () => {
  mailOff();
  const db = fakeDb();
  assert.equal((await call('POST', {}, FORM)).status, 200);
  assert.equal(db.emails.length, 0);
  assert.ok(!db.calls.some((c) => c.url.includes('resend')), 'the email service is never even contacted');
});

test('a confidential grievance emails the right people, with nothing about the case in it', async () => {
  mailOn();
  try {
    let db = fakeDb();
    const made = (await call('POST', {}, Object.assign({}, FORM, { subject: 'SECRET SUBJECT', body: 'SECRET BODY', involves: 'none' }))).data;
    assert.equal(db.emails.length, 1);
    assert.deepEqual(sorted(db.emails[0].to), ['admin@x.test', 'legal2@x.test', 'legal@x.test'], 'Legal Compliance and the Administrator; not another department, not someone who left');
    assert.equal(db.emails[0].auth, 'Bearer re_test_key');
    assert.equal(db.emails[0].subject, 'New grievance ' + made.ticket_no);
    const all = JSON.stringify(db.emails[0]);
    for (const secret of ['SECRET SUBJECT', 'SECRET BODY', 'Test Person', 'SNG-0001', ME, 'pay_benefits', 'Overtime']) assert.ok(!all.includes(secret), 'the email must not contain ' + secret);
    assert.ok(all.includes(made.ticket_no) && all.includes('https://x.test/members/'));

    db = fakeDb();
    await call('POST', {}, Object.assign({}, FORM, { involves: 'legal_member' }));
    assert.deepEqual(db.emails[0].to, ['admin@x.test'], 'a case involving Legal goes to the Administrator only');
    db = fakeDb();
    await call('POST', {}, Object.assign({}, FORM, { involves: 'administrator' }));
    assert.deepEqual(sorted(db.emails[0].to), ['legal2@x.test', 'legal@x.test'], 'a case involving the Administrator goes to Legal Compliance only');
  } finally { mailOff(); }
});

test('an anonymous grievance or reply never causes an immediate email', async () => {
  mailOn();
  try {
    const db = fakeDb();
    const made = (await call('POST', {}, Object.assign({}, FORM, { anonymous: true }))).data;
    await call('POST', {}, { action: 'reply', ticket: made.ticket_no, code: made.access_code, body: 'More' });
    assert.equal(db.emails.length, 0);
  } finally { mailOff(); }
});

test('only the first message of the day on a confidential case sends an email', async () => {
  mailOn();
  try {
    const db = fakeDb();
    await call('POST', {}, FORM);
    db.emails.length = 0;
    const id = db.grievances[0].id;
    await call('POST', {}, { action: 'reply', id, body: 'first' });
    await call('POST', {}, { action: 'reply', id, body: 'second' });
    await call('POST', {}, { action: 'reply', id, body: 'third' });
    assert.equal(db.emails.length, 1);
    assert.match(db.emails[0].subject, /^New message on grievance GRV-/);
  } finally { mailOff(); }
});

test('a broken email service never stops a grievance from being saved', async () => {
  mailOn();
  try {
    const db = fakeDb();
    db.mailFails = true;
    const r = await call('POST', {}, FORM);
    assert.equal(r.status, 200);
    assert.equal(db.grievances.length, 1);
  } finally { mailOff(); }
});

/* ---------- the daily summary ---------- */
test('the daily summary needs the cron secret', async () => {
  const db = fakeDb();
  assert.equal((await cron()).status, 401, 'no CRON_SECRET set on the server');
  process.env.CRON_SECRET = 'a-long-cron-secret-123';
  try {
    assert.equal((await cron()).status, 401, 'no header');
    assert.equal((await cron({ authorization: 'Bearer wrong-secret-000000' })).status, 401);
    assert.equal((await cron({ authorization: 'a-long-cron-secret-123' })).status, 401, 'must be a Bearer header');
    assert.ok(!db.calls.some((c) => c.url.includes('grievance_digest')), 'nothing is read without the secret');
    assert.equal((await cron({ authorization: 'Bearer a-long-cron-secret-123' }, 'POST')).status, 405);
    assert.equal((await cron({ authorization: 'Bearer a-long-cron-secret-123' })).status, 200);
  } finally { delete process.env.CRON_SECRET; }
  process.env.CRON_SECRET = 'short';
  try { assert.equal((await cron({ authorization: 'Bearer short' })).status, 401, 'a short secret is refused'); } finally { delete process.env.CRON_SECRET; }
});

test('the daily summary sends counts only, to the right group, and nothing when all is quiet', async () => {
  mailOn();
  process.env.CRON_SECRET = 'a-long-cron-secret-123';
  const auth = { authorization: 'Bearer a-long-cron-secret-123' };
  try {
    let db = fakeDb();
    let r = await cron(auth);
    assert.deepEqual(r.data.sent, { admin: false, legal: false });
    assert.equal(db.emails.length, 0, 'all quiet: no email');

    db = fakeDb();
    db.digest = { admin: { unacknowledged: 2, awaiting_reply: 1, overdue: 0 }, legal: { unacknowledged: 0, awaiting_reply: 0, overdue: 3 } };
    r = await cron(auth);
    assert.deepEqual(r.data.sent, { admin: true, legal: true });
    const toAdmin = db.emails.find((e) => e.to.includes('admin@x.test')), toLegal = db.emails.find((e) => e.to.includes('legal@x.test'));
    assert.deepEqual(toAdmin.to, ['admin@x.test']);
    assert.deepEqual(sorted(toLegal.to), ['legal2@x.test', 'legal@x.test']);
    assert.equal(toAdmin.subject, 'Grievances need attention: 2 not yet acknowledged, 1 waiting for a reply');
    assert.equal(toLegal.subject, 'Grievances need attention: 3 overdue');
    const all = JSON.stringify(db.emails);
    assert.ok(!/GRV-|SNG-|Test Person|pay_benefits/.test(all), 'counts only: no ticket numbers, names or categories');
  } finally { mailOff(); delete process.env.CRON_SECRET; }
});

test('the scheduler in vercel.json points at the summary route that exists', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(cfg.crons.length, 1);
  assert.equal(cfg.crons[0].path, '/api/employee-evaluate?gr=digest');
  assert.match(cfg.crons[0].schedule, /^\d+ \d+ \* \* \*$/, 'once a day');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', 'employee-evaluate.js')));
});

test('the case id goes back only to the owner of a confidential grievance, never for an anonymous one', async () => {
  const db = fakeDb();
  const conf = (await call('POST', {}, FORM)).data;
  assert.equal(conf.id, db.grievances[0].id);
  assert.equal(conf.access_code, null);
  const anon = (await call('POST', {}, Object.assign({}, FORM, { anonymous: true }))).data;
  assert.equal(anon.id, null);
  assert.match(anon.access_code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
});
