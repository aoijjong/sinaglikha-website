/* Photos on Employee Forum discussions. The database and storage are stubbed with fetch. */
process.env.EMPLOYEE_SESSION_SECRET = 'y'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', THREAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IMG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const COOKIE = 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1);
const BASE = 'https://example.supabase.co/storage/v1';

/* opts: mine (is the thread the signed-in employee's), recent, images (rows already attached), tableMissing, stored (did the file arrive), signFails */
function fakeDb(opts = {}) {
  const o = Object.assign({ mine: true, recent: true, images: [], tableMissing: false, stored: true, signFails: false }, opts);
  const log = [];
  global.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET', dec = decodeURIComponent(u);
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    log.push({ method, url: u, body: opt.body ? JSON.parse(opt.body) : null });
    if (u.startsWith(BASE)) {
      if (u.includes('/object/upload/sign/forum-images/')) return o.signFails ? reply(500, {}) : reply(200, { url: '/object/upload/sign/forum-images/' + u.split('/forum-images/')[1] + '?token=t' });
      if (u.includes('/object/info/forum-images/')) return o.stored ? reply(200, { size: 1000 }) : reply(404, {});
      if (u.includes('/object/sign/forum-images')) return reply(200, JSON.parse(opt.body).paths.map((p) => ({ path: p, signedURL: '/object/sign/forum-images/' + p + '?token=z' })));
    }
    if (u.includes('/employee_secrets')) return reply(200, [{ session_version: 1 }]);
    if (u.includes('/employees?id=eq.')) return reply(200, [{ id: ME, employee_no: 'HRS-0001', full_name: 'Maria Santos', position: 'X', active: true, pin_set: true }]);
    if (u.includes('/employees?id=in.')) return reply(200, []);
    if (u.includes('/forum_categories')) return reply(200, [{ id: CAT, name: 'General', description: '' }]);
    if (u.includes('/forum_images')) {
      if (o.tableMissing) return reply(404, { code: '42P01' });
      if (method === 'POST') return reply(201, [Object.assign({ id: IMG }, JSON.parse(opt.body))]);
      if (method === 'PATCH' || method === 'DELETE') return reply(204, []);
      if (dec.includes('id=eq.' + IMG)) return reply(200, [{ id: IMG, path: THREAD + '/x.jpg', thread_id: THREAD, confirmed: false }]);
      return reply(200, o.images);
    }
    if (u.includes('/forum_threads')) {
      if (u.includes('employee_id=eq.') && !o.mine) return reply(200, []);
      if (u.includes('created_at=gte.') && !o.recent) return reply(200, []);
      return reply(200, [{ id: THREAD, category_id: CAT, employee_id: ME, title: 't', body: 'b', locked: false, hidden: false, anonymous: true, created_at: '2026-11-23T00:00:00Z', last_post_at: '2026-11-23T00:00:00Z' }]);
    }
    return reply(200, []);
  };
  return log;
}
function call(method, query, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    forum({ method, query: query || {}, headers: { cookie: COOKIE, host: 'x.test', 'content-type': 'application/json' }, body }, res);
  });
}
const ask = (over) => call('POST', {}, Object.assign({ action: 'image_url', thread_id: THREAD, mime: 'image/jpeg', size: 200000 }, over));

test('the author gets a one-time upload address, and the stored path has a random name in the discussion folder (nothing about the author)', async () => {
  const log = fakeDb();
  const r = await ask();
  assert.equal(r.status, 200);
  assert.equal(r.data.image_id, IMG);
  assert.match(r.data.upload_url, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/forum-images\//);
  const row = log.find((x) => x.method === 'POST' && x.url.includes('/forum_images')).body;
  assert.match(row.path, /^dddddddd-dddd-4ddd-8ddd-dddddddddddd\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(row.confirmed, false);
  assert.ok(!JSON.stringify(row).includes(ME), 'no employee id is stored with the photo');
});

test('only JPG, PNG or WEBP, and no more than 3 MB', async () => {
  fakeDb();
  assert.equal((await ask({ mime: 'application/pdf' })).status, 400);
  assert.equal((await ask({ mime: 'image/svg+xml' })).status, 400);
  assert.equal((await ask({ size: 3 * 1024 * 1024 + 1 })).status, 400);
  assert.equal((await ask({ size: 0 })).status, 400);
  assert.equal((await ask({ size: 'big' })).status, 400);
  assert.equal((await ask({ thread_id: 'nope' })).status, 400);
  assert.equal((await ask({ mime: 'image/png', size: 3 * 1024 * 1024 })).status, 200);
});

test('only the author can add photos, and only soon after posting', async () => {
  fakeDb({ mine: false });
  assert.equal((await ask()).status, 404, "someone else's discussion");
  fakeDb({ recent: false });
  assert.equal((await ask()).status, 404, 'an old discussion');
});

test('no more than four photos on one discussion', async () => {
  const four = [1, 2, 3, 4].map((n) => ({ id: 'i' + n, confirmed: true, created_at: '2026-11-01T00:00:00Z' }));
  fakeDb({ images: four });
  const r = await ask();
  assert.equal(r.status, 400);
  assert.match(r.data.error, /up to 4 photos/);
  fakeDb({ images: four.slice(0, 3) });
  assert.equal((await ask()).status, 200, 'three is fine');
});

test('before the SQL is run, adding a photo says it is not switched on (and the feed says so too)', async () => {
  fakeDb({ tableMissing: true });
  const r = await ask();
  assert.equal(r.status, 503);
  assert.match(r.data.error, /aren't switched on/);
  const f = await call('GET', { feed: '1' });
  assert.equal(f.status, 200);
  assert.equal(f.data.images_on, false);
});

test('a failed upload address leaves nothing behind', async () => {
  const log = fakeDb({ signFails: true });
  assert.equal((await ask()).status, 502);
  assert.ok(log.some((x) => x.method === 'DELETE' && x.url.includes('/forum_images')), 'the reserved row is removed');
});

test('confirming a photo checks it really arrived', async () => {
  const log = fakeDb({ stored: false });
  assert.equal((await call('POST', {}, { action: 'image_done', image_id: IMG })).status, 404);
  assert.ok(!log.some((x) => x.method === 'PATCH'), 'not marked as done');
  const log2 = fakeDb({ stored: true });
  assert.equal((await call('POST', {}, { action: 'image_done', image_id: IMG })).status, 200);
  assert.ok(log2.some((x) => x.method === 'PATCH' && x.body.confirmed === true));
  fakeDb({ mine: false });
  assert.equal((await call('POST', {}, { action: 'image_done', image_id: IMG })).status, 404, "not someone else's photo");
  assert.equal((await call('POST', {}, { action: 'image_done', image_id: 'x' })).status, 400);
});

test('the feed gives each discussion its confirmed photos as short-lived links, and says photos are on', async () => {
  fakeDb({ images: [{ thread_id: THREAD, path: THREAD + '/a.jpg' }, { thread_id: THREAD, path: THREAD + '/b.jpg' }] });
  const f = await call('GET', { feed: '1' });
  assert.equal(f.data.images_on, true);
  const t = f.data.threads[0];
  assert.equal(t.images.length, 2);
  assert.ok(t.images.every((u) => u.startsWith(BASE + '/object/sign/forum-images/' + THREAD + '/') && u.includes('token=')));
  assert.ok(!JSON.stringify(f.data).includes(ME), 'an anonymous discussion with photos still reveals no author');
});

test('a discussion with no photos has an empty list, and a photo that cannot be signed is left out', async () => {
  fakeDb();
  assert.deepEqual((await call('GET', { feed: '1' })).data.threads[0].images, []);
  fakeDb({ images: [{ thread_id: THREAD, path: THREAD + '/a.jpg' }] });
  const real = global.fetch;
  global.fetch = async (url, opt) => (String(url).includes('/object/sign/forum-images') ? { ok: false, status: 500, json: async () => ({}) } : real(url, opt));
  assert.deepEqual((await call('GET', { feed: '1' })).data.threads[0].images, []);
});
