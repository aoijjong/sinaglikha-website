/*
  Hearts on announcements and community threads (supabase/post_likes.sql).

  GET  /api/employee-likes?kind=announcement|thread&ids=<id>,<id>,...   how many hearts each post has, and which ones are yours
  POST /api/employee-likes  { "kind": "announcement" | "thread", "item_id": "...", "liked": true | false }

  The person comes from the sign-in cookie, never from the request. A post can only be liked once per person.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['announcement', 'thread'];
const MAX_IDS = 60;
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

async function countFor(kind, id) {
  const rows = list(await E.rest('GET', `post_likes?kind=eq.${kind}&item_id=eq.${id}&select=employee_id&limit=5000`));
  return rows.length;
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

  if (req.method === 'POST') {
    const body = await E.readJson(req);
    if (!body) return E.send(res, 400, { error: 'Bad request.' });
    const kind = String(body.kind || ''), id = String(body.item_id || '');
    if (KINDS.indexOf(kind) === -1 || !UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });

    if (body.liked) {
      // the post has to exist and be visible to employees
      const table = kind === 'announcement' ? `announcements?id=eq.${id}&published=eq.true` : `forum_threads?id=eq.${id}&hidden=eq.false`;
      if (!list(await E.rest('GET', `${table}&select=id`))[0]) return E.send(res, 404, { error: "That isn't available any more." });
      const r = await E.rest('POST', 'post_likes?on_conflict=employee_id,kind,item_id', { employee_id: eid, kind, item_id: id }, 'resolution=ignore-duplicates,return=minimal');
      if (!r.ok) return E.send(res, 500, { error: "Couldn't save that. Try again." });
    } else {
      const r = await E.rest('DELETE', `post_likes?employee_id=eq.${eid}&kind=eq.${kind}&item_id=eq.${id}`, undefined, 'return=minimal');
      if (!r.ok) return E.send(res, 500, { error: "Couldn't save that. Try again." });
    }
    return E.send(res, 200, { ok: true, count: await countFor(kind, id), liked: !!body.liked });
  }

  const q = req.query || {};
  const kind = String(q.kind || '');
  const ids = String(q.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (KINDS.indexOf(kind) === -1 || !ids.length || ids.length > MAX_IDS || ids.some((x) => !UUID_RE.test(x))) return E.send(res, 400, { error: 'Bad request.' });
  const rows = list(await E.rest('GET', `post_likes?kind=eq.${kind}&item_id=in.(${ids.join(',')})&select=item_id,employee_id&limit=5000`));
  const counts = {}, mine = [];
  rows.forEach((r) => {
    counts[r.item_id] = (counts[r.item_id] || 0) + 1;
    if (r.employee_id === eid) mine.push(r.item_id);
  });
  return E.send(res, 200, { counts, mine });
};
