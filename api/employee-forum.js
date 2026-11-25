/*
  The Employee Forum for the signed-in employee (supabase/phase3.sql). No private messages.

  GET  /api/employee-forum?feed=1                   the open categories and the latest threads across them (the
                                                    dashboard's discussion feed)
  GET  /api/employee-forum                          the open categories, with how many threads each has
  GET  /api/employee-forum?category=<id>            the threads in one category, newest activity first
  GET  /api/employee-forum?thread=<id>              one thread and its replies
  POST /api/employee-forum  { "action": "thread", "category_id": "...", "title": "..."?, "body": "..."?, "photos": 2?, "anonymous": true? }
                                                    (title and message are both optional, but there must be one of them or a photo)
  POST /api/employee-forum  { "action": "reply",  "thread_id": "...", "body": "...", "anonymous": true? }
  POST /api/employee-forum  { "action": "image_url",  "thread_id": "...", "mime": "image/jpeg", "size": 123456 }   reserve a photo place on
                                                    YOUR new discussion and get a one-time upload address (supabase/forum_images.sql)
  POST /api/employee-forum  { "action": "image_done", "image_id": "..." }                                      confirm the photo arrived
  POST /api/employee-forum  { "action": "report", "thread_id" | "post_id": "...", "reason": "..." }
  POST /api/employee-forum  { "action": "delete", "thread_id" | "post_id": "..." }   remove one of your OWN posts

  Posts carry the employee's own name unless they chose "anonymous": then other employees see "Anon Likhain" and no
  photo. The author is still stored (employee_id) so moderators can see who wrote it, the author can delete it, and
  the flood limits work. The author comes from the sign-in cookie, never from the request. Hidden threads and posts, closed categories and locked threads are never sent or accepted.
  Flood limit: 5 new threads or replies in 10 minutes, and 5 reports in an hour. Text is kept as plain
  text; the pages show it without ever treating it as HTML.
*/

const crypto = require('crypto');
const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOOD_POSTS = 5;
const FLOOD_MINUTES = 10;
const FLOOD_REPORTS = 5;
const IMG_MAX = 4, IMG_BYTES = 3 * 1024 * 1024, IMG_WINDOW_MIN = 30;   // photos: per discussion, per photo, and how long after posting they can be added
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMG_OFF = { error: "Photo attachments aren't switched on yet. Ask your administrator." };

function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

/* Anonymous posting needs supabase/forum_anonymous.sql. Until it has run, the insert is refused by the database;
   say so plainly. A post the author asked to hide is never published under their name instead. */
const ANON_OFF = { error: "Anonymous posting isn't switched on yet. Ask your administrator, or post with your name." };
const wantsAnon = (body) => body.anonymous === true;
const noAnonColumn = (r) => !r.ok && r.status === 400 && /anonymous/i.test(JSON.stringify(r.data || ''));

/* The one-time address the browser uploads a photo to: it only works for that one path, for a short time. */
async function signUpload(path) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  try {
    const r = await fetch(`${E.URL_BASE}/storage/v1/object/upload/sign/forum-images/${enc}`, {
      method: 'POST', headers: E.svc({ 'Content-Type': 'application/json' }), body: '{}', signal: AbortSignal.timeout(8000)
    });
    const d = r.ok ? await r.json() : null;
    if (!d || typeof d.url !== 'string') return null;
    const full = d.url.startsWith('http') ? d.url : `${E.URL_BASE}/storage/v1${d.url}`;
    return full.startsWith(`${E.URL_BASE}/storage/v1/object/upload/sign/forum-images/`) ? full : null;
  } catch { return null; }
}
/* did the photo really arrive? Returns its size, or null. */
async function storedSize(path) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  try {
    const r = await fetch(`${E.URL_BASE}/storage/v1/object/info/forum-images/${enc}`, { headers: E.svc(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const n = Number(d && (d.size !== undefined ? d.size : d.metadata && d.metadata.size));
    return Number.isFinite(n) ? n : 0;
  } catch { return null; }
}

async function names(ids) {
  const out = {};
  const unique = Array.from(new Set(ids));
  if (!unique.length) return out;
  const r = await E.rest('GET', `employees?id=in.(${unique.join(',')})&select=id,full_name`);
  list(r).forEach((e) => { out[e.id] = e.full_name; });
  return out;
}

async function tooFast(table, eid, minutes, limit) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const r = await E.rest('GET', `${table}?employee_id=eq.${eid}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${limit}`);
  return list(r).length >= limit;
}

module.exports = async function handler(req, res) {
  // comments on announcements live in _comments.js; they share this endpoint so the site stays within Vercel's 12-function limit
  if (req.query && req.query.cm !== undefined) return require('./_comments')(req, res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });
  const eid = me.emp.id;
  const gone = { error: "That isn't available any more." };

  if (req.method === 'POST') {
    const body = await E.readJson(req);
    if (!body) return E.send(res, 400, { error: 'Bad request.' });

    if (body.action === 'thread') {
      const cat = String(body.category_id || ''), title = clean(body.title, 120), text = clean(body.body, 2000);
      if (!UUID_RE.test(cat)) return E.send(res, 400, { error: 'Bad request.' });
      // Title and message are both optional, but a discussion needs something: a title, a message, or at least one photo
      // (the photos are uploaded right after, so the page says how many it is sending).
      const photoCount = Number.isInteger(body.photos) && body.photos >= 1 && body.photos <= IMG_MAX ? body.photos : 0;
      if (!title && !text && !photoCount) return E.send(res, 400, { error: 'Add a title, a message or a photo to post.' });
      let c = await E.rest('GET', `forum_categories?id=eq.${cat}&active=eq.true&select=id,scope`);
      if (!c.ok && c.status === 400) c = await E.rest('GET', `forum_categories?id=eq.${cat}&active=eq.true&select=id`);   // before forum_departments.sql
      if (!list(c)[0]) return E.send(res, 404, gone);
      // a department-only category: the discussion is stamped with the poster's own department (from their record, never from the request)
      let dept = null;
      if (list(c)[0].scope === 'departmental') {
        dept = await E.deptOf(eid);
        if (!dept) return E.send(res, 400, { error: "Your account has no department yet, so you can't post in a department space. Ask your administrator." });
      }
      if ((await tooFast('forum_threads', eid, FLOOD_MINUTES, FLOOD_POSTS)) || (await tooFast('forum_posts', eid, FLOOD_MINUTES, FLOOD_POSTS))) {
        return E.send(res, 429, { error: 'You are posting very quickly. Wait a few minutes and try again.' });
      }
      const anon = wantsAnon(body);
      const row = (t, b) => Object.assign({ category_id: cat, employee_id: eid, title: t, body: b }, dept ? { department: dept } : {}, anon ? { anonymous: true } : {});
      // The title and message may be empty (supabase/forum_optional_title.sql lets the database accept that). Before that SQL
      // has run it still wants both, so fill the gaps from what was written (or "Photo"), so posting never breaks.
      let r = await E.rest('POST', 'forum_threads', row(title, text), 'return=representation');
      if ((!title || !text) && !r.ok && r.status === 400 && /23514|check constraint|title|body/i.test(JSON.stringify(r.data || ''))) {
        const first = text.replace(/\s+/g, ' ');
        const t2 = title || (first ? (first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first) : 'Photo');
        r = await E.rest('POST', 'forum_threads', row(t2, text || title || 'Photo'), 'return=representation');
      }
      if (anon && noAnonColumn(r)) return E.send(res, 503, ANON_OFF);
      if (!r.ok || !list(r)[0]) return E.send(res, 500, { error: "Couldn't post that. Try again." });
      return E.send(res, 200, { ok: true, id: r.data[0].id });
    }

    if (body.action === 'reply') {
      const tid = String(body.thread_id || ''), text = clean(body.body, 2000);
      if (!UUID_RE.test(tid)) return E.send(res, 400, { error: 'Bad request.' });
      if (!text) return E.send(res, 400, { error: 'Write a reply first.' });
      const seen = await E.visibleThread(eid, tid);
      const thread = seen && seen.thread;
      if (!thread) return E.send(res, 404, gone);
      if (thread.locked) return E.send(res, 409, { error: 'This thread is locked, so it cannot take new replies.' });
      if ((await tooFast('forum_threads', eid, FLOOD_MINUTES, FLOOD_POSTS)) || (await tooFast('forum_posts', eid, FLOOD_MINUTES, FLOOD_POSTS))) {
        return E.send(res, 429, { error: 'You are posting very quickly. Wait a few minutes and try again.' });
      }
      const anon = wantsAnon(body);
      const r = await E.rest('POST', 'forum_posts', Object.assign({ thread_id: tid, employee_id: eid, body: text }, anon ? { anonymous: true } : {}), 'return=representation');
      if (anon && noAnonColumn(r)) return E.send(res, 503, ANON_OFF);
      if (!r.ok || !list(r)[0]) return E.send(res, 500, { error: "Couldn't post that. Try again." });
      await E.rest('PATCH', `forum_threads?id=eq.${tid}`, { last_post_at: new Date().toISOString() }, 'return=minimal');
      return E.send(res, 200, { ok: true, id: r.data[0].id });
    }

    if (body.action === 'image_url' || body.action === 'image_done') {
      if (body.action === 'image_url') {
        const tid = String(body.thread_id || ''), mime = String(body.mime || ''), size = Number(body.size);
        if (!UUID_RE.test(tid)) return E.send(res, 400, { error: 'Bad request.' });
        if (!IMG_EXT[mime]) return E.send(res, 400, { error: 'Use a JPG, PNG or WEBP photo.' });
        if (!Number.isInteger(size) || size < 1 || size > IMG_BYTES) return E.send(res, 400, { error: 'That photo is too large. The limit is 3 MB.' });
        // only the author, only on a visible discussion, and only soon after posting it
        const since = new Date(Date.now() - IMG_WINDOW_MIN * 60000).toISOString();
        const t = list(await E.rest('GET', `forum_threads?id=eq.${tid}&employee_id=eq.${eid}&hidden=eq.false&created_at=gte.${encodeURIComponent(since)}&select=id`))[0];
        if (!t) return E.send(res, 404, gone);
        const have = await E.rest('GET', `forum_images?thread_id=eq.${tid}&select=id,confirmed,created_at&limit=20`);
        if (!have.ok) return E.send(res, 503, IMG_OFF);
        const day = new Date(Date.now() - 24 * 3600000).toISOString();
        if (list(have).filter((x) => x.confirmed || String(x.created_at) >= day).length >= IMG_MAX) return E.send(res, 400, { error: `You can attach up to ${IMG_MAX} photos.` });
        const path = `${tid}/${crypto.randomUUID()}.${IMG_EXT[mime]}`;   // a random name inside the discussion's folder: nothing says who posted it
        const made = list(await E.rest('POST', 'forum_images', { thread_id: tid, path, size_bytes: size, mime, confirmed: false }, 'return=representation'))[0];
        if (!made) return E.send(res, 500, { error: "Couldn't prepare that photo. Try again." });
        const url = await signUpload(path);
        if (!url) {
          await E.rest('DELETE', `forum_images?id=eq.${made.id}`, undefined, 'return=minimal');
          return E.send(res, 502, { error: "Couldn't prepare the upload. Try again in a moment." });
        }
        return E.send(res, 200, { ok: true, image_id: made.id, upload_url: url });
      }
      const iid = String(body.image_id || '');
      if (!UUID_RE.test(iid)) return E.send(res, 400, { error: 'Bad request.' });
      const img = list(await E.rest('GET', `forum_images?id=eq.${iid}&select=id,path,thread_id,confirmed`))[0];
      const own = img && list(await E.rest('GET', `forum_threads?id=eq.${img.thread_id}&employee_id=eq.${eid}&select=id`))[0];
      if (!img || !own) return E.send(res, 404, gone);
      if (img.confirmed) return E.send(res, 200, { ok: true });
      if ((await storedSize(img.path)) === null) return E.send(res, 404, { error: 'That photo did not finish uploading. Please try again.' });
      const done = await E.rest('PATCH', `forum_images?id=eq.${iid}`, { confirmed: true }, 'return=minimal');
      if (!done.ok) return E.send(res, 500, { error: "Couldn't finish that photo. Try again." });
      return E.send(res, 200, { ok: true });
    }

    if (body.action === 'delete') {
      // An employee can only remove their own thread or reply. It is hidden, not erased, so moderators
      // keep the record (and any reports about it) and can still see what was said.
      const tid = body.thread_id ? String(body.thread_id) : null, pid = body.post_id ? String(body.post_id) : null;
      if ((!tid && !pid) || (tid && !UUID_RE.test(tid)) || (pid && !UUID_RE.test(pid))) return E.send(res, 400, { error: 'Bad request.' });
      const target = tid ? `forum_threads?id=eq.${tid}` : `forum_posts?id=eq.${pid}`;
      const r = await E.rest('PATCH', `${target}&employee_id=eq.${eid}&hidden=eq.false`, { hidden: true }, 'return=representation');
      if (!r.ok || !list(r)[0]) return E.send(res, 404, gone);
      await E.logAudit('forum.delete', me.emp.employee_no, { thread: tid, post: pid });
      return E.send(res, 200, { ok: true });
    }

    if (body.action === 'report') {
      const tid = body.thread_id ? String(body.thread_id) : null, pid = body.post_id ? String(body.post_id) : null;
      if ((!tid && !pid) || (tid && !UUID_RE.test(tid)) || (pid && !UUID_RE.test(pid))) return E.send(res, 400, { error: 'Bad request.' });
      // you can only report what you can see
      let rtid = tid;
      if (pid) rtid = (list(await E.rest('GET', `forum_posts?id=eq.${pid}&hidden=eq.false&select=thread_id`))[0] || {}).thread_id || null;
      if (!rtid || !(await E.visibleThread(eid, rtid))) return E.send(res, 404, gone);
      if (await tooFast('forum_reports', eid, 60, FLOOD_REPORTS)) return E.send(res, 429, { error: 'You have sent several reports already. A moderator will look at them.' });
      const r = await E.rest('POST', 'forum_reports', { thread_id: tid, post_id: pid, employee_id: eid, reason: clean(body.reason, 300) }, 'return=minimal');
      if (!r.ok) return E.send(res, 500, { error: "Couldn't send that report. Try again." });
      await E.logAudit('forum.report', me.emp.employee_no, { thread: tid, post: pid });
      return E.send(res, 200, { ok: true });
    }
    return E.send(res, 400, { error: 'Bad request.' });
  }

  const q = req.query || {};

  if (q.feed !== undefined) return E.send(res, 200, await E.forumFeed(eid));

  if (q.thread !== undefined) {
    const id = String(q.thread);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const seen = await E.visibleThread(eid, id);
    if (!seen) return E.send(res, 404, gone);
    const thread = seen.thread, cat = seen.cat;
    const p = await E.rest('GET', `forum_posts?thread_id=eq.${id}&hidden=eq.false&select=*&order=created_at.asc&limit=500`);
    const posts = list(p);
    const authors = E.publicIds([thread].concat(posts));
    const [who, pack] = await Promise.all([names(authors), E.photoPack('employees', authors)]);
    return E.send(res, 200, {
      category: E.catView(cat),
      photos: pack.pics,
      thread: { id: thread.id, title: thread.title, body: thread.body, locked: thread.locked, created_at: thread.created_at, ...E.byline(thread, who, null, eid) },
      posts: posts.map((x) => ({ id: x.id, body: x.body, created_at: x.created_at, ...E.byline(x, who, pack, eid) }))
    });
  }

  if (q.category !== undefined) {
    const id = String(q.category);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const c = await E.rest('GET', `forum_categories?id=eq.${id}&active=eq.true&select=*`);
    const cat = list(c)[0];
    if (!cat) return E.send(res, 404, gone);
    if (cat.scope === 'departmental' && !(await E.deptOf(eid))) return E.send(res, 404, gone);
    const t = await E.threadsGet(`forum_threads?category_id=eq.${id}&hidden=eq.false&select=*&order=last_post_at.desc&limit=100`, await E.deptOf(eid));
    const threads = list(t);
    const ids = threads.map((x) => x.id);
    const p = ids.length ? list(await E.rest('GET', `forum_posts?thread_id=in.(${ids.join(',')})&hidden=eq.false&select=thread_id&limit=5000`)) : [];
    const count = {};
    p.forEach((x) => { count[x.thread_id] = (count[x.thread_id] || 0) + 1; });
    const who = await names(E.publicIds(threads));
    return E.send(res, 200, {
      category: E.catView(cat),
      threads: threads.map((x) => ({
        id: x.id, title: x.title, preview: x.body.slice(0, 160), locked: x.locked, replies: count[x.id] || 0,
        ...E.byline(x, who, null, eid), created_at: x.created_at, last_post_at: x.last_post_at
      }))
    });
  }

  const c = await E.rest('GET', 'forum_categories?active=eq.true&select=*&order=position,created_at');
  // Before supabase/phase3.sql has been run the tables don't exist yet: show nothing.
  if (!c.ok || !Array.isArray(c.data)) return E.send(res, 200, { categories: [] });
  const t = list(await E.threadsGet('forum_threads?hidden=eq.false&select=category_id&limit=5000', await E.deptOf(eid)));
  const count = {};
  t.forEach((x) => { count[x.category_id] = (count[x.category_id] || 0) + 1; });
  return E.send(res, 200, { categories: c.data.map((x) => ({ ...E.catView(x), threads: count[x.id] || 0 })) });
};
