/*
  The Employee Forum for the signed-in employee (supabase/phase3.sql). No private messages.

  GET  /api/employee-forum?feed=1                   the open categories and the latest threads across them (the
                                                    dashboard's discussion feed)
  GET  /api/employee-forum                          the open categories, with how many threads each has
  GET  /api/employee-forum?category=<id>            the threads in one category, newest activity first
  GET  /api/employee-forum?thread=<id>              one thread and its replies
  POST /api/employee-forum  { "action": "thread", "category_id": "...", "title": "...", "body": "..." }
  POST /api/employee-forum  { "action": "reply",  "thread_id": "...", "body": "..." }
  POST /api/employee-forum  { "action": "report", "thread_id" | "post_id": "...", "reason": "..." }
  POST /api/employee-forum  { "action": "delete", "thread_id" | "post_id": "..." }   remove one of your OWN posts

  Posts carry the employee's own name. The author comes from the sign-in cookie, never from the
  request. Hidden threads and posts, closed categories and locked threads are never sent or accepted.
  Flood limit: 5 new threads or replies in 10 minutes, and 5 reports in an hour. Text is kept as plain
  text; the pages show it without ever treating it as HTML.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOOD_POSTS = 5;
const FLOOD_MINUTES = 10;
const FLOOD_REPORTS = 5;

function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

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
      if (!title) return E.send(res, 400, { error: 'Give your thread a title.' });
      if (!text) return E.send(res, 400, { error: 'Write something in your thread.' });
      const c = await E.rest('GET', `forum_categories?id=eq.${cat}&active=eq.true&select=id`);
      if (!list(c)[0]) return E.send(res, 404, gone);
      if ((await tooFast('forum_threads', eid, FLOOD_MINUTES, FLOOD_POSTS)) || (await tooFast('forum_posts', eid, FLOOD_MINUTES, FLOOD_POSTS))) {
        return E.send(res, 429, { error: 'You are posting very quickly. Wait a few minutes and try again.' });
      }
      const r = await E.rest('POST', 'forum_threads', { category_id: cat, employee_id: eid, title, body: text }, 'return=representation');
      if (!r.ok || !list(r)[0]) return E.send(res, 500, { error: "Couldn't post that. Try again." });
      return E.send(res, 200, { ok: true, id: r.data[0].id });
    }

    if (body.action === 'reply') {
      const tid = String(body.thread_id || ''), text = clean(body.body, 2000);
      if (!UUID_RE.test(tid)) return E.send(res, 400, { error: 'Bad request.' });
      if (!text) return E.send(res, 400, { error: 'Write a reply first.' });
      const t = await E.rest('GET', `forum_threads?id=eq.${tid}&hidden=eq.false&select=id,locked,category_id`);
      const thread = list(t)[0];
      if (!thread) return E.send(res, 404, gone);
      if (thread.locked) return E.send(res, 409, { error: 'This thread is locked, so it cannot take new replies.' });
      if ((await tooFast('forum_threads', eid, FLOOD_MINUTES, FLOOD_POSTS)) || (await tooFast('forum_posts', eid, FLOOD_MINUTES, FLOOD_POSTS))) {
        return E.send(res, 429, { error: 'You are posting very quickly. Wait a few minutes and try again.' });
      }
      const r = await E.rest('POST', 'forum_posts', { thread_id: tid, employee_id: eid, body: text }, 'return=representation');
      if (!r.ok || !list(r)[0]) return E.send(res, 500, { error: "Couldn't post that. Try again." });
      await E.rest('PATCH', `forum_threads?id=eq.${tid}`, { last_post_at: new Date().toISOString() }, 'return=minimal');
      return E.send(res, 200, { ok: true, id: r.data[0].id });
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
    const t = await E.rest('GET', `forum_threads?id=eq.${id}&hidden=eq.false&select=id,category_id,employee_id,title,body,locked,created_at`);
    const thread = list(t)[0];
    if (!thread) return E.send(res, 404, gone);
    const c = await E.rest('GET', `forum_categories?id=eq.${thread.category_id}&active=eq.true&select=id,name`);
    const cat = list(c)[0];
    if (!cat) return E.send(res, 404, gone);
    const p = await E.rest('GET', `forum_posts?thread_id=eq.${id}&hidden=eq.false&select=id,employee_id,body,created_at&order=created_at.asc&limit=500`);
    const posts = list(p);
    const authors = [thread.employee_id].concat(posts.map((x) => x.employee_id));
    const [who, pack] = await Promise.all([names(authors), E.photoPack('employees', authors)]);
    return E.send(res, 200, {
      category: cat,
      photos: pack.pics,
      thread: { id: thread.id, title: thread.title, body: thread.body, locked: thread.locked, created_at: thread.created_at, author: who[thread.employee_id] || 'Employee', mine: thread.employee_id === eid },
      posts: posts.map((x) => ({ id: x.id, body: x.body, created_at: x.created_at, author: who[x.employee_id] || 'Employee', pic: pack.at(x.employee_id), mine: x.employee_id === eid }))
    });
  }

  if (q.category !== undefined) {
    const id = String(q.category);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const c = await E.rest('GET', `forum_categories?id=eq.${id}&active=eq.true&select=id,name,description`);
    const cat = list(c)[0];
    if (!cat) return E.send(res, 404, gone);
    const t = await E.rest('GET', `forum_threads?category_id=eq.${id}&hidden=eq.false&select=id,employee_id,title,body,locked,created_at,last_post_at&order=last_post_at.desc&limit=100`);
    const threads = list(t);
    const ids = threads.map((x) => x.id);
    const p = ids.length ? list(await E.rest('GET', `forum_posts?thread_id=in.(${ids.join(',')})&hidden=eq.false&select=thread_id&limit=5000`)) : [];
    const count = {};
    p.forEach((x) => { count[x.thread_id] = (count[x.thread_id] || 0) + 1; });
    const who = await names(threads.map((x) => x.employee_id));
    return E.send(res, 200, {
      category: cat,
      threads: threads.map((x) => ({
        id: x.id, title: x.title, preview: x.body.slice(0, 160), locked: x.locked, replies: count[x.id] || 0,
        author: who[x.employee_id] || 'Employee', created_at: x.created_at, last_post_at: x.last_post_at
      }))
    });
  }

  const c = await E.rest('GET', 'forum_categories?active=eq.true&select=id,name,description&order=position,created_at');
  // Before supabase/phase3.sql has been run the tables don't exist yet: show nothing.
  if (!c.ok || !Array.isArray(c.data)) return E.send(res, 200, { categories: [] });
  const t = list(await E.rest('GET', 'forum_threads?hidden=eq.false&select=category_id&limit=5000'));
  const count = {};
  t.forEach((x) => { count[x.category_id] = (count[x.category_id] || 0) + 1; });
  return E.send(res, 200, { categories: c.data.map((x) => ({ id: x.id, name: x.name, description: x.description || '', threads: count[x.id] || 0 })) });
};
