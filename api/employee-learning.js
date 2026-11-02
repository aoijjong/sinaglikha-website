/*
  Learning for the signed-in employee (supabase/phase3.sql).

  GET  /api/employee-learning                       the published courses, with how many modules there are
                                                    and how many of them THIS employee has completed
  GET  /api/employee-learning?course=<id>           one published course and its modules, each marked done
                                                    or not for this employee
  GET  /api/employee-learning?open=<module id>      a 5-minute link to open one module (links go straight to
                                                    their web address)
  POST /api/employee-learning  { "action": "done" | "undo", "module_id": "<id>" }   mark a module complete

  The employee comes from the sign-in cookie, never from the request, so progress can only be read or
  changed for oneself. Drafts (unpublished courses) are never sent.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function publishedModule(id) {
  const m = await E.rest('GET', `learning_modules?id=eq.${id}&select=id,course_id,kind,url,file_path`);
  const mod = m.ok && Array.isArray(m.data) && m.data[0];
  if (!mod) return null;
  const c = await E.rest('GET', `learning_courses?id=eq.${mod.course_id}&published=eq.true&select=id`);
  return c.ok && Array.isArray(c.data) && c.data[0] ? mod : null;
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
    const id = body && String(body.module_id || '');
    if (!body || (body.action !== 'done' && body.action !== 'undo') || !UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    if (!(await publishedModule(id))) return E.send(res, 404, gone);
    const r = body.action === 'done'
      ? await E.rest('POST', 'learning_progress', { employee_id: eid, module_id: id }, 'resolution=ignore-duplicates,return=minimal')
      : await E.rest('DELETE', `learning_progress?employee_id=eq.${eid}&module_id=eq.${id}`, undefined, 'return=minimal');
    if (!r.ok) return E.send(res, 500, { error: "Couldn't save that. Try again." });
    return E.send(res, 200, { ok: true });
  }

  const q = req.query || {};

  if (q.open !== undefined) {
    const id = String(q.open);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const mod = await publishedModule(id);
    if (!mod) return E.send(res, 404, gone);
    if (mod.kind === 'link') {
      if (!/^https?:\/\//i.test(mod.url || '')) return E.send(res, 404, gone);
      return E.send(res, 200, { url: mod.url });
    }
    const url = mod.file_path ? await E.signUrl('content', mod.file_path) : null;
    if (!url) return E.send(res, 502, { error: "Couldn't open that file. Try again in a moment." });
    return E.send(res, 200, { url });
  }

  if (q.course !== undefined) {
    const id = String(q.course);
    if (!UUID_RE.test(id)) return E.send(res, 400, { error: 'Bad request.' });
    const c = await E.rest('GET', `learning_courses?id=eq.${id}&published=eq.true&select=id,title,description`);
    const course = c.ok && Array.isArray(c.data) && c.data[0];
    if (!course) return E.send(res, 404, gone);
    const [m, p] = await Promise.all([
      E.rest('GET', `learning_modules?course_id=eq.${id}&select=id,title,description,kind&order=position,created_at`),
      E.rest('GET', `learning_progress?employee_id=eq.${eid}&select=module_id`)
    ]);
    const done = new Set((p.ok && Array.isArray(p.data) ? p.data : []).map((x) => x.module_id));
    const modules = (m.ok && Array.isArray(m.data) ? m.data : []).map((x) => ({
      id: x.id, title: x.title, description: x.description || '', kind: x.kind, done: done.has(x.id)
    }));
    return E.send(res, 200, { course, modules });
  }

  const c = await E.rest('GET', 'learning_courses?published=eq.true&select=id,title,description&order=position,created_at');
  // Before supabase/phase3.sql has been run the tables don't exist yet: show nothing.
  if (!c.ok || !Array.isArray(c.data) || !c.data.length) return E.send(res, 200, { courses: [] });
  const ids = c.data.map((x) => x.id).join(',');
  const [m, p] = await Promise.all([
    E.rest('GET', `learning_modules?course_id=in.(${ids})&select=id,course_id&limit=5000`),
    E.rest('GET', `learning_progress?employee_id=eq.${eid}&select=module_id&limit=5000`)
  ]);
  const mods = m.ok && Array.isArray(m.data) ? m.data : [];
  const done = new Set((p.ok && Array.isArray(p.data) ? p.data : []).map((x) => x.module_id));
  return E.send(res, 200, {
    courses: c.data.map((x) => {
      const own = mods.filter((y) => y.course_id === x.id);
      return { id: x.id, title: x.title, description: x.description || '', total: own.length, done: own.filter((y) => done.has(y.id)).length };
    })
  });
};
