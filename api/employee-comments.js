/*
  Comments on announcements for the signed-in employee (supabase/announcement_comments.sql).

  GET  /api/employee-comments?counts=<id>,<id>,...         how many comments each announcement has
  GET  /api/employee-comments?announcement=<id>            the comments on one announcement, oldest first
  POST /api/employee-comments { "action": "add",    "announcement_id": "...", "body": "..." }
  POST /api/employee-comments { "action": "delete", "comment_id": "..." }      remove one of your OWN comments

  The author comes from the sign-in cookie, never from the request. Only published announcements take
  comments. Text is kept as plain text; the page shows it without ever treating it as HTML.
  Flood limit: 8 comments in 10 minutes.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOOD = 8;
const FLOOD_MINUTES = 10;
const MAX_IDS = 60;
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
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

    if (body.action === 'add') {
      const aid = String(body.announcement_id || ''), text = clean(body.body, 1000);
      if (!UUID_RE.test(aid)) return E.send(res, 400, { error: 'Bad request.' });
      if (!text) return E.send(res, 400, { error: 'Write a comment first.' });
      if (!list(await E.rest('GET', `announcements?id=eq.${aid}&published=eq.true&select=id`))[0]) return E.send(res, 404, gone);
      const since = new Date(Date.now() - FLOOD_MINUTES * 60000).toISOString();
      const recent = list(await E.rest('GET', `announcement_comments?employee_id=eq.${eid}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${FLOOD}`));
      if (recent.length >= FLOOD) return E.send(res, 429, { error: 'You are commenting very quickly. Wait a few minutes and try again.' });
      const r = await E.rest('POST', 'announcement_comments', { announcement_id: aid, employee_id: eid, body: text }, 'return=representation');
      if (!r.ok || !list(r)[0]) return E.send(res, 500, { error: "Couldn't post that. Try again." });
      return E.send(res, 200, { ok: true, id: r.data[0].id });
    }

    if (body.action === 'delete') {
      const cid = String(body.comment_id || '');
      if (!UUID_RE.test(cid)) return E.send(res, 400, { error: 'Bad request.' });
      const r = await E.rest('PATCH', `announcement_comments?id=eq.${cid}&employee_id=eq.${eid}&hidden=eq.false`, { hidden: true }, 'return=representation');
      if (!r.ok || !list(r)[0]) return E.send(res, 404, gone);
      await E.logAudit('announcement.comment.delete', me.emp.employee_no, { comment: cid });
      return E.send(res, 200, { ok: true });
    }
    return E.send(res, 400, { error: 'Bad request.' });
  }

  const q = req.query || {};

  if (q.counts !== undefined) {
    const ids = String(q.counts).split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > MAX_IDS || ids.some((x) => !UUID_RE.test(x))) return E.send(res, 400, { error: 'Bad request.' });
    // Before the SQL has been run the table does not exist yet: report no comments rather than an error.
    const rows = list(await E.rest('GET', `announcement_comments?announcement_id=in.(${ids.join(',')})&hidden=eq.false&select=announcement_id&limit=5000`));
    const counts = {};
    rows.forEach((x) => { counts[x.announcement_id] = (counts[x.announcement_id] || 0) + 1; });
    return E.send(res, 200, { counts });
  }

  if (q.announcement !== undefined) {
    const id = String(q.announcement);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    if (!list(await E.rest('GET', `announcements?id=eq.${id}&published=eq.true&select=id`))[0]) return E.send(res, 404, gone);
    const comments = list(await E.rest('GET', `announcement_comments?announcement_id=eq.${id}&hidden=eq.false&select=id,employee_id,body,created_at&order=created_at.asc&limit=300`));
    const authors = comments.map((x) => x.employee_id);
    const [who, pack] = await Promise.all([E.namesOf ? E.namesOf(authors) : {}, E.photoPack('employees', authors)]);
    return E.send(res, 200, {
      photos: pack.pics,
      comments: comments.map((x) => ({
        id: x.id, body: x.body, created_at: x.created_at,
        author: (who && who[x.employee_id]) || 'Employee', pic: pack.at(x.employee_id), mine: x.employee_id === eid
      }))
    });
  }
  return E.send(res, 400, { error: 'Bad request.' });
};
