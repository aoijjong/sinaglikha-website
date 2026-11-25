/* Photos on forum replies and announcement comments. The database and storage are stubbed with fetch. */
process.env.EMPLOYEE_SESSION_SECRET = 'y'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', THREAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ANN = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const POST = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', COMMENT = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', IMG = '99999999-9999-4999-8999-999999999999';
const COOKIE = 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1);
const BASE = 'https://example.supabase.co/storage/v1';

/* opts: mine, recent, images (rows in the photo table), tableMissing, stored, bodyRequired (comment_images.sql not run: text is still required) */
function fakeDb(opts = {}) {
  const o = Object.assign({ mine: true, recent: true, images: [], tableMissing: false, stored: true, bodyRequired: false }, opts);
  const log = [];
  global.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET', dec = decodeURIComponent(u);
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    log.push({ method, url: u, body: opt.body ? JSON.parse(opt.body) : null });
    if (u.startsWith(BASE)) {
      if (u.includes('/object/upload/sign/forum-images/')) return reply(200, { url: '/object/upload/sign/forum-images/' + u.split('/forum-images/')[1] + '?token=t' });
      if (u.includes('/object/info/forum-images/')) return o.stored ? reply(200, { size: 1000 }) : reply(404, {});
      if (u.includes('/object/sign/forum-images')) return reply(200, JSON.parse(opt.body).paths.map((p) => ({ path: p, signedURL: '/object/sign/forum-images/' + p + '?token=z' })));
    }
    if (u.includes('/employee_secrets')) return reply(200, [{ session_version: 1 }]);
    if (u.includes('/employees?id=eq.')) return reply(200, [{ id: ME, employee_no: 'HRS-0001', full_name: 'Maria', position: 'X', active: true, pin_set: true }]);
    if (u.includes('/employees?id=in.')) return reply(200, []);
    if (u.includes('/forum_categories')) return reply(200, [{ id: CAT, name: 'General', description: '' }]);
    if (u.includes('/forum_post_images') || u.includes('/announcement_comment_images')) {
      if (o.tableMissing) return reply(404, { code: '42P01' });
      if (method === 'POST') return reply(201, [Object.assign({ id: IMG }, JSON.parse(opt.body))]);
      if (method === 'PATCH' || method === 'DELETE') return reply(204, []);
      if (dec.includes('id=eq.' + IMG)) return reply(200, [{ id: IMG, path: 'r/x.jpg', post_id: POST, comment_id: COMMENT, confirmed: false }]);
      return reply(200, o.images);
    }
    if (method === 'POST' && (u.includes('/forum_posts') || u.includes('/announcement_comments'))) {
      const b = JSON.parse(opt.body);
      if (o.bodyRequired && !b.body) return reply(400, { code: '23514', message: 'violates check constraint "forum_posts_body_check"' });
      return reply(201, [Object.assign({ id: POST }, b)]);
    }
    if (u.includes('/forum_posts?id=eq.') || u.includes('/announcement_comments?id=eq.')) {
      // like the real database: the row is only found if the question asks for the signed-in employee's own row (and for a recent one)
      if ((u.includes('employee_id=eq.') && !o.mine) || (u.includes('created_at=gte.') && !o.recent)) return reply(200, []);
      return reply(200, [{ id: POST, thread_id: THREAD }]);
    }
    if (u.includes('/forum_threads')) return reply(200, [{ id: THREAD, category_id: CAT, employee_id: OTHER, title: 't', body: 'b', locked: false, hidden: false, created_at: '2026-11-23T00:00:00Z', last_post_at: '2026-11-23T00:00:00Z' }]);
    if (u.includes('/forum_posts')) return reply(200, [{ id: POST, thread_id: THREAD, employee_id: OTHER, body: 'hi', hidden: false, created_at: '2026-11-23T00:01:00Z' }]);
    if (u.includes('/announcements?id=eq.')) return reply(200, [{ id: ANN }]);
    if (u.includes('/announcement_comments')) return reply(200, [{ id: COMMENT, employee_id: OTHER, body: 'hi', created_at: '2026-11-23T00:01:00Z' }]);
    return reply(200, []);
  };
  return log;
}
function call(method, query, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    forum({ method, query: Object.assign({}, query), headers: { cookie: COOKIE, host: 'x.test', 'content-type': 'application/json' }, body }, res);
  });
}
/* both kinds: a forum reply (post_id) and an announcement comment (comment_id, through ?cm=1) */
const KINDS = [
  { name: 'reply', q: {}, url: 'reply_image_url', done: 'reply_image_done', ask: (o) => Object.assign({ action: 'reply_image_url', post_id: POST, mime: 'image/jpeg', size: 200000 }, o), prefix: 'r/' + POST + '/', table: 'forum_post_images' },
  { name: 'comment', q: { cm: '1' }, url: 'image_url', done: 'image_done', ask: (o) => Object.assign({ action: 'image_url', comment_id: COMMENT, mime: 'image/jpeg', size: 200000 }, o), prefix: 'c/' + COMMENT + '/', table: 'announcement_comment_images' }
];

for (const K of KINDS) {
  test(K.name + ': the author gets a one-time upload address, with a random name in the post\'s own folder', async () => {
    const log = fakeDb();
    const r = await call('POST', K.q, K.ask());
    assert.equal(r.status, 200);
    assert.equal(r.data.image_id, IMG);
    assert.match(r.data.upload_url, /\/object\/upload\/sign\/forum-images\//);
    const row = log.find((x) => x.method === 'POST' && x.url.includes('/' + K.table)).body;
    assert.ok(row.path.startsWith(K.prefix) && /\.jpg$/.test(row.path));
    assert.ok(!JSON.stringify(row).includes(ME), 'nothing about the author is stored with the photo');
  });

  test(K.name + ': only JPG, PNG or WEBP, at most 3 MB, a real id', async () => {
    fakeDb();
    assert.equal((await call('POST', K.q, K.ask({ mime: 'application/pdf' }))).status, 400);
    assert.equal((await call('POST', K.q, K.ask({ mime: 'image/svg+xml' }))).status, 400);
    assert.equal((await call('POST', K.q, K.ask({ size: 3 * 1024 * 1024 + 1 }))).status, 400);
    assert.equal((await call('POST', K.q, K.ask({ size: 0 }))).status, 400);
    assert.equal((await call('POST', K.q, K.ask({ post_id: 'nope', comment_id: 'nope' }))).status, 400);
    assert.equal((await call('POST', K.q, K.ask({ mime: 'image/png' }))).status, 200);
  });

  test(K.name + ': only the author, and only soon after posting', async () => {
    fakeDb({ mine: false });
    assert.equal((await call('POST', K.q, K.ask())).status, 404, "someone else's");
    fakeDb({ recent: false });
    assert.equal((await call('POST', K.q, K.ask())).status, 404, 'too late');
  });

  test(K.name + ': no more than three photos', async () => {
    const three = [1, 2, 3].map((n) => ({ id: 'i' + n, confirmed: true, created_at: '2026-11-01T00:00:00Z' }));
    fakeDb({ images: three });
    const r = await call('POST', K.q, K.ask());
    assert.equal(r.status, 400);
    assert.match(r.data.error, /up to 3 photos/);
    fakeDb({ images: three.slice(0, 2) });
    assert.equal((await call('POST', K.q, K.ask())).status, 200);
  });

  test(K.name + ': before the SQL is run it says photos are not switched on', async () => {
    fakeDb({ tableMissing: true });
    const r = await call('POST', K.q, K.ask());
    assert.equal(r.status, 503);
    assert.match(r.data.error, /aren't switched on/);
  });

  test(K.name + ': confirming checks the file arrived, and that it is the author\'s own', async () => {
    const a = fakeDb({ stored: false });
    assert.equal((await call('POST', K.q, { action: K.done, image_id: IMG })).status, 404);
    assert.ok(!a.some((x) => x.method === 'PATCH'));
    const b = fakeDb();
    assert.equal((await call('POST', K.q, { action: K.done, image_id: IMG })).status, 200);
    assert.ok(b.some((x) => x.method === 'PATCH' && x.body.confirmed === true));
    fakeDb({ mine: false });
    assert.equal((await call('POST', K.q, { action: K.done, image_id: IMG })).status, 404);
  });
}

test('a reply may be a photo alone; with nothing at all it is refused', async () => {
  const w = fakeDb();
  assert.equal((await call('POST', {}, { action: 'reply', thread_id: THREAD, body: '', photos: 2 })).status, 200);
  assert.equal(w.find((x) => x.method === 'POST' && x.url.includes('/forum_posts')).body.body, '');
  const w2 = fakeDb();
  for (const extra of [{}, { photos: 0 }, { photos: 4 }, { photos: '1' }]) assert.equal((await call('POST', {}, Object.assign({ action: 'reply', thread_id: THREAD, body: ' ' }, extra))).status, 400, JSON.stringify(extra));
  assert.ok(!w2.some((x) => x.method === 'POST' && x.url.includes('/forum_posts')));
});

test('a comment may be a photo alone; with nothing at all it is refused', async () => {
  const w = fakeDb();
  assert.equal((await call('POST', { cm: '1' }, { action: 'add', announcement_id: ANN, body: '', photos: 1 })).status, 200);
  assert.equal(w.find((x) => x.method === 'POST' && x.url.includes('/announcement_comments')).body.body, '');
  fakeDb();
  assert.equal((await call('POST', { cm: '1' }, { action: 'add', announcement_id: ANN, body: '', photos: 0 })).status, 400);
});

test('before the SQL is run, a photo-only reply or comment still posts, with "Photo" as its text', async () => {
  const w = fakeDb({ bodyRequired: true });
  assert.equal((await call('POST', {}, { action: 'reply', thread_id: THREAD, body: '', photos: 1 })).status, 200);
  assert.equal(w.filter((x) => x.method === 'POST' && x.url.includes('/forum_posts')).at(-1).body.body, 'Photo');
  const w2 = fakeDb({ bodyRequired: true });
  assert.equal((await call('POST', { cm: '1' }, { action: 'add', announcement_id: ANN, body: '', photos: 1 })).status, 200);
  assert.equal(w2.filter((x) => x.method === 'POST' && x.url.includes('/announcement_comments')).at(-1).body.body, 'Photo');
});

test('opening a discussion gives each reply its photos as short-lived links; the same for comments', async () => {
  fakeDb({ images: [{ post_id: POST, comment_id: COMMENT, path: 'r/' + POST + '/a.jpg' }] });
  const t = await call('GET', { thread: THREAD });
  assert.equal(t.data.images_on, true);
  assert.equal(t.data.posts[0].images.length, 1);
  assert.ok(t.data.posts[0].images[0].startsWith(BASE + '/object/sign/forum-images/r/') && t.data.posts[0].images[0].includes('token='));
  const c = await call('GET', { cm: '1', announcement: ANN });
  assert.equal(c.data.images_on, true);
  assert.equal(c.data.comments[0].images.length, 1);
  fakeDb({ tableMissing: true });
  const off = await call('GET', { thread: THREAD });
  assert.equal(off.status, 200);
  assert.equal(off.data.images_on, false);
  assert.deepEqual(off.data.posts[0].images, []);
});
