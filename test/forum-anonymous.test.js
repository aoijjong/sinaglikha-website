/* Optional anonymous posting in the Community forum. The database is stubbed with fetch. */
process.env.EMPLOYEE_SESSION_SECRET = 'y'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', THREAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NAMES = { [ME]: 'Maria Santos', [OTHER]: 'Jose Reyes' };
const COOKIE = 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1);

/* A tiny fake Supabase. `db` holds rows; `posts` records every write the handler makes. */
function fakeDb(db, { columnMissing = false } = {}) {
  const writes = [];
  global.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET';
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (method === 'POST') {
      const body = JSON.parse(opt.body);
      writes.push({ table: u.split('/rest/v1/')[1].split('?')[0], body });
      if (columnMissing && 'anonymous' in body) return reply(400, { code: 'PGRST204', message: "Could not find the 'anonymous' column of 'forum_threads' in the schema cache" });
      return reply(201, [Object.assign({ id: THREAD }, body)]);
    }
    if (method === 'PATCH') return reply(200, []);
    if (u.includes('/employee_secrets')) return reply(200, [{ session_version: 1 }]);
    if (u.includes('/employees?id=eq.')) return reply(200, [{ id: ME, employee_no: 'HRS-0001', full_name: NAMES[ME], position: 'X', active: true, pin_set: true }]);
    if (u.includes('/employees?id=in.')) {
      const ids = decodeURIComponent(u).match(/in\.\(([^)]*)\)/)[1].split(',').filter(Boolean);
      return reply(200, ids.map((id) => ({ id, full_name: NAMES[id] })));
    }
    if (u.includes('/forum_categories')) return reply(200, [{ id: CAT, name: 'General', description: '' }]);
    if (u.includes('/forum_threads?id=eq.') && !u.includes('&employee_id')) return reply(200, db.threads.filter((t) => u.includes(t.id)));
    if (u.includes('/forum_threads')) return reply(200, db.threads);
    if (u.includes('/forum_posts')) return reply(200, db.posts);
    return reply(200, []);   // flood checks, photos, etc.
  };
  return writes;
}
function call(method, query, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    forum({ method, query: query || {}, headers: { cookie: COOKIE, host: 'x.test', 'content-type': 'application/json' }, body }, res);
  });
}
const T = (over) => Object.assign({ id: THREAD, category_id: CAT, employee_id: OTHER, title: 't', body: 'b', locked: false, hidden: false, created_at: '2026-11-23T00:00:00Z', last_post_at: '2026-11-23T00:00:00Z' }, over);
const P = (over) => Object.assign({ id: 'p1', thread_id: THREAD, employee_id: OTHER, body: 'hi', hidden: false, created_at: '2026-11-23T00:01:00Z' }, over);

test('an anonymous thread is stored with anonymous: true; a normal one sends no new field', async () => {
  const w = fakeDb({ threads: [], posts: [] });
  assert.equal((await call('POST', {}, { action: 'thread', category_id: CAT, title: 'T', body: 'B', anonymous: true })).status, 200);
  assert.equal(w.at(-1).body.anonymous, true);
  assert.equal(w.at(-1).body.employee_id, ME, 'the author is still recorded for moderators');
  await call('POST', {}, { action: 'thread', category_id: CAT, title: 'T', body: 'B' });
  assert.ok(!('anonymous' in w.at(-1).body), 'old behaviour is unchanged, so it works before the SQL is run');
  await call('POST', {}, { action: 'thread', category_id: CAT, title: 'T', body: 'B', anonymous: 'true' });
  assert.ok(!('anonymous' in w.at(-1).body), 'only a real boolean true counts');
});

test('a reply can be anonymous too', async () => {
  const w = fakeDb({ threads: [T()], posts: [] });
  await call('POST', {}, { action: 'reply', thread_id: THREAD, body: 'hello', anonymous: true });
  assert.equal(w.find((x) => x.table === 'forum_posts').body.anonymous, true);
});

test('before the SQL is run, an anonymous post is refused and never posted under the name', async () => {
  const w = fakeDb({ threads: [], posts: [] }, { columnMissing: true });
  const r = await call('POST', {}, { action: 'thread', category_id: CAT, title: 'T', body: 'B', anonymous: true });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /isn't switched on/);
  assert.equal(w.filter((x) => x.table === 'forum_threads').length, 1, 'exactly one attempt, no named fallback');
  const r2 = await call('POST', {}, { action: 'reply', thread_id: THREAD, body: 'x', anonymous: true });
  assert.notEqual(r2.status, 200);
});

test('colleagues see "Anon Likhain" with no name, photo or id; the author sees "mine"', () => {
  const pack = { at: () => 3 };
  const anon = E.byline({ employee_id: OTHER, anonymous: true }, NAMES, pack, ME);
  assert.deepEqual(anon, { author: 'Anon Likhain', pic: undefined, anonymous: true, mine: false });
  const mine = E.byline({ employee_id: ME, anonymous: true }, NAMES, pack, ME);
  assert.equal(mine.mine, true);
  assert.equal(mine.author, 'Anon Likhain');
  const named = E.byline({ employee_id: OTHER, anonymous: false }, NAMES, pack, ME);
  assert.deepEqual(named, { author: 'Jose Reyes', pic: 3, anonymous: false, mine: false });
  const old = E.byline({ employee_id: OTHER }, NAMES, pack, ME);   // row from before the column existed
  assert.equal(old.author, 'Jose Reyes');
});

test('thread, category and feed responses never leak an anonymous author', async () => {
  fakeDb({ threads: [T({ anonymous: true }), T({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', anonymous: false })], posts: [P({ anonymous: true }), P({ id: 'p2', anonymous: false })] });
  const detail = await call('GET', { thread: THREAD });
  const cat = await call('GET', { category: CAT });
  const feed = await call('GET', { feed: '1' });
  for (const r of [detail, cat, feed]) {
    assert.equal(r.status, 200);
    const json = JSON.stringify(r.data);
    assert.ok(!json.includes(OTHER), 'the author id is never sent');
    assert.ok(json.includes('Anon Likhain'));
  }
  assert.equal(detail.data.thread.author, 'Anon Likhain');
  assert.equal(detail.data.posts[0].author, 'Anon Likhain');
  assert.equal(detail.data.posts[1].author, 'Jose Reyes', 'a named reply in the same thread still shows its name');
  assert.equal(feed.data.threads[0].author, 'Anon Likhain');
  assert.equal(feed.data.threads[1].author, 'Jose Reyes');
});

test('works on rows from before the column existed', async () => {
  fakeDb({ threads: [T()], posts: [P()] });
  const r = await call('GET', { thread: THREAD });
  assert.equal(r.data.thread.author, 'Jose Reyes');
  assert.equal(r.data.thread.anonymous, false);
});
