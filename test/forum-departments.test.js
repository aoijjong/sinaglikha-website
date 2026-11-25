/* General and department-only spaces in the Employee Forum. The database is stubbed with fetch. */
process.env.EMPLOYEE_SESSION_SECRET = 'y'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');
const likes = require('../api/employee-likes.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', DEP = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const T_GEN = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', T_LEGAL = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', T_REWARDS = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3';
const COOKIE = 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1);

const thread = (id, cat, department) => Object.assign({ id, category_id: cat, employee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 't', body: 'b', locked: false, hidden: false, anonymous: false, created_at: '2026-11-23T00:00:00Z', last_post_at: '2026-11-23T00:00:00Z' }, department ? { department } : {});

/* opts: dept (the signed-in employee's department), columnsMissing (forum_departments.sql not run yet) */
function fakeDb(opts = {}) {
  const o = Object.assign({ dept: 'legal', columnsMissing: false }, opts);
  const threads = [thread(T_GEN, GEN), thread(T_LEGAL, DEP, 'legal'), thread(T_REWARDS, DEP, 'rewards')];
  const cats = [{ id: GEN, name: 'General', description: '', scope: 'general' }, { id: DEP, name: 'Department', description: '', scope: 'departmental' }];
  const writes = [];
  const sees = (t, u) => {
    const m = decodeURIComponent(u).match(/or=\(department\.is\.null,department\.eq\.(\w+)\)/);
    if (m) return !t.department || t.department === m[1];
    if (u.includes('department=is.null')) return !t.department;
    return true;
  };
  global.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET';
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (method === 'POST') {
      const body = JSON.parse(opt.body);
      writes.push({ table: u.split('/rest/v1/')[1].split('?')[0], body });
      return reply(201, [Object.assign({ id: 'new1' }, body)]);
    }
    if (method === 'PATCH' || method === 'DELETE') return reply(200, []);
    if (u.includes('/employee_secrets')) return reply(200, [{ session_version: 1 }]);
    if (u.includes('select=department')) return reply(200, o.dept ? [{ department: o.dept }] : [{ department: null }]);
    if (u.includes('/employees?id=eq.')) return reply(200, [{ id: ME, employee_no: 'HRS-0001', full_name: 'Maria', position: 'X', active: true, pin_set: true }]);
    if (u.includes('/employees?id=in.')) return reply(200, []);
    if (u.includes('/forum_categories')) {
      if (o.columnsMissing && u.includes('select=id,scope')) return reply(400, { code: '42703', message: 'column scope does not exist' });
      const one = decodeURIComponent(u).match(/id=eq\.([\w-]+)/);
      const rows = (one ? cats.filter((c) => c.id === one[1]) : cats).map((c) => (o.columnsMissing ? { id: c.id, name: c.name, description: '' } : c));
      return reply(200, rows);
    }
    if (u.includes('/forum_images')) return reply(200, []);
    if (u.includes('/forum_posts?id=eq.')) return reply(200, [{ thread_id: T_LEGAL }]);
    if (u.includes('/forum_posts')) return reply(200, []);
    if (u.includes('/forum_threads')) {
      const hasFilter = u.includes('department.eq.') || u.includes('department=is.null');
      if (o.columnsMissing && hasFilter) return reply(400, { code: '42703', message: 'column department does not exist' });
      const one = u.match(/forum_threads\?id=eq\.([\w-]+)/);
      let rows = threads.filter((t) => sees(t, u));
      if (one) rows = threads.filter((t) => t.id === one[1]);
      return reply(200, o.columnsMissing ? rows.map((t) => { const c = Object.assign({}, t); delete c.department; return c; }).filter((t) => !t.__x) : rows);
    }
    return reply(200, []);
  };
  return writes;
}
function callWith(handler, method, query, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    handler({ method, query: query || {}, headers: { cookie: COOKIE, host: 'x.test', 'content-type': 'application/json' }, body }, res);
  });
}
const call = (m, q, b) => callWith(forum, m, q, b);

test('the feed gives a department only its own department discussions, plus the general ones', async () => {
  fakeDb({ dept: 'legal' });
  const f = await call('GET', { feed: '1' });
  const ids = f.data.threads.map((t) => t.id).sort();
  assert.deepEqual(ids, [T_GEN, T_LEGAL].sort(), 'general + Legal only: the Rewards discussion is not there');
  assert.equal(f.data.my_dept, 'legal');
  assert.deepEqual(f.data.categories.map((c) => c.scope).sort(), ['departmental', 'general']);
});

test('an employee with no department sees the general discussions only', async () => {
  fakeDb({ dept: null });
  const f = await call('GET', { feed: '1' });
  assert.deepEqual(f.data.threads.map((t) => t.id), [T_GEN]);
  assert.equal(f.data.my_dept, null);
});

test("another department's discussion is not available by any route: open, reply, report, like", async () => {
  fakeDb({ dept: 'legal' });
  assert.equal((await call('GET', { thread: T_REWARDS })).status, 404, 'open it');
  assert.equal((await call('POST', {}, { action: 'reply', thread_id: T_REWARDS, body: 'hi' })).status, 404, 'reply to it');
  assert.equal((await call('POST', {}, { action: 'report', thread_id: T_REWARDS })).status, 404, 'report it');
  assert.equal((await callWith(likes, 'POST', {}, { kind: 'thread', item_id: T_REWARDS, liked: true })).status, 404, 'like it');
  assert.equal((await call('GET', { thread: T_LEGAL })).status, 200, 'but its own department is fine');
  assert.equal((await call('POST', {}, { action: 'reply', thread_id: T_LEGAL, body: 'hi' })).status, 200);
  assert.equal((await call('GET', { thread: T_GEN })).status, 200, 'and general is fine');
  assert.equal((await callWith(likes, 'POST', {}, { kind: 'thread', item_id: T_LEGAL, liked: true })).status, 200, 'and liking its own department is fine');
});

test('a department category that is not yours cannot be listed, and the counts leave other departments out', async () => {
  fakeDb({ dept: null });
  assert.equal((await call('GET', { category: DEP })).status, 404, 'no department: the department space is closed');
  fakeDb({ dept: 'legal' });
  const c = await call('GET', {});
  assert.equal(c.data.categories.find((x) => x.id === DEP).threads, 1, 'Legal sees only its own one, not the Rewards one');
});

test("posting in a department category stamps the poster's own department, whatever the request says", async () => {
  const w = fakeDb({ dept: 'legal' });
  const r = await call('POST', {}, { action: 'thread', category_id: DEP, title: 'T', body: 'B', department: 'rewards' });
  assert.equal(r.status, 200);
  assert.equal(w.find((x) => x.table === 'forum_threads').body.department, 'legal');
  const w2 = fakeDb({ dept: 'legal' });
  await call('POST', {}, { action: 'thread', category_id: GEN, title: 'T', body: 'B', department: 'legal' });
  assert.ok(!('department' in w2.find((x) => x.table === 'forum_threads').body), 'a general post carries no department');
});

test('no department means no posting in a department space', async () => {
  const w = fakeDb({ dept: null });
  const r = await call('POST', {}, { action: 'thread', category_id: DEP, title: 'T', body: 'B' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no department/);
  assert.ok(!w.some((x) => x.table === 'forum_threads'));
  assert.equal((await call('POST', {}, { action: 'thread', category_id: GEN, title: 'T', body: 'B' })).status, 200, 'general still works');
});

test('before the SQL is run everything works as before (all general)', async () => {
  const w = fakeDb({ columnsMissing: true });
  const f = await call('GET', { feed: '1' });
  assert.equal(f.status, 200);
  assert.equal(f.data.threads.length, 3, 'nothing is hidden');
  assert.ok(f.data.categories.every((c) => c.scope === 'general'));
  assert.equal((await call('POST', {}, { action: 'thread', category_id: GEN, title: 'T', body: 'B' })).status, 200);
  assert.ok(!('department' in w.find((x) => x.table === 'forum_threads').body));
});
