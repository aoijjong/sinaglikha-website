/* The title of an Employee Forum discussion is optional. The database is stubbed with fetch. */
process.env.EMPLOYEE_SESSION_SECRET = 'y'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COOKIE = 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1);

/* titleRequired: the database still has the old "title must not be empty" rule (forum_optional_title.sql not run yet) */
function fakeDb({ titleRequired = false } = {}) {
  const inserts = [];
  global.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET';
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (method === 'POST' && u.includes('/forum_threads')) {
      const body = JSON.parse(opt.body);
      inserts.push(body);
      if (titleRequired && !body.title) return reply(400, { code: '23514', message: 'new row for relation "forum_threads" violates check constraint "forum_threads_title_check"' });
      return reply(201, [Object.assign({ id: 'new1' }, body)]);
    }
    if (u.includes('/employee_secrets')) return reply(200, [{ session_version: 1 }]);
    if (u.includes('/employees?id=eq.')) return reply(200, [{ id: ME, employee_no: 'HRS-0001', full_name: 'Maria', position: 'X', active: true, pin_set: true }]);
    if (u.includes('/forum_categories')) return reply(200, [{ id: CAT, name: 'General', description: '' }]);
    return reply(200, []);
  };
  return inserts;
}
function call(body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    forum({ method: 'POST', query: {}, headers: { cookie: COOKIE, host: 'x.test', 'content-type': 'application/json' }, body }, res);
  });
}

test('a discussion needs no title: it is saved with an empty one', async () => {
  const w = fakeDb();
  const r = await call({ action: 'thread', category_id: CAT, body: 'Just a thought.' });
  assert.equal(r.status, 200);
  assert.equal(w.length, 1);
  assert.equal(w[0].title, '');
  assert.equal(w[0].body, 'Just a thought.');
});

test('a title, when given, is kept', async () => {
  const w = fakeDb();
  assert.equal((await call({ action: 'thread', category_id: CAT, title: '  Parking  ', body: 'b' })).status, 200);
  assert.equal(w[0].title, 'Parking');
});

test('the message is still required', async () => {
  const w = fakeDb();
  const r = await call({ action: 'thread', category_id: CAT, title: 'Only a title', body: '   ' });
  assert.equal(r.status, 400);
  assert.equal(w.length, 0);
});

test('before the SQL is run, the first words of the message stand in as the title, and posting still works', async () => {
  const w = fakeDb({ titleRequired: true });
  const r = await call({ action: 'thread', category_id: CAT, body: 'Short message here' });
  assert.equal(r.status, 200);
  assert.equal(w.length, 2, 'tried empty, then retried');
  assert.equal(w[1].title, 'Short message here');
  const long = 'word '.repeat(40);
  const w2 = fakeDb({ titleRequired: true });
  await call({ action: 'thread', category_id: CAT, body: long });
  assert.ok(w2[1].title.length <= 58 && w2[1].title.endsWith('…'), 'long messages are cut: ' + w2[1].title);
});

test('an empty title is not retried when the failure is something else', async () => {
  fakeDb();
  const real = global.fetch;
  global.fetch = async (url, opt) => (String(url).includes('/forum_threads') && (opt || {}).method === 'POST' ? { ok: false, status: 500, json: async () => ({ message: 'boom' }) } : real(url, opt));
  assert.equal((await call({ action: 'thread', category_id: CAT, body: 'b' })).status, 500);
});
