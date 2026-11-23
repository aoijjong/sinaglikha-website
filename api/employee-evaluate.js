/*
  The Self and Peer evaluations an employee fills in (supabase/phase6.sql). Needs an employee sign-in.

  GET  /api/employee-evaluate                       the open Self and Peer forms for this employee's department
  POST /api/employee-evaluate { "action": "self",  "form_id", "answers": [...], "overall", "submit": true|false }
                                                    save a draft or submit the employee's OWN self-assessment
  POST /api/employee-evaluate { "action": "peer_list", "form_id" }
                                                    the colleagues of the SAME DEPARTMENT, and which ones this employee already evaluated
  POST /api/employee-evaluate { "action": "peer", "form_id", "colleague_id", "answers": [...], "overall" }
                                                    submit a peer evaluation of one colleague of the same department

  answers = [{ "id": "<question id>", "rating": 4, "comment": "...", "picked": ["Option A"] }]
  Question types: short, paragraph, choice, checkbox, dropdown, rating (linear scale), stars, date, time.

  Who is evaluating comes from the sign-in cookie, never from the request. A peer evaluation is only for
  an active colleague of the employee's own department (set in the Employee Directory), and never for
  oneself. The employee sees the names of their own department only. A form made for one department can
  only be used by that department. A peer evaluation is final once sent; a self-assessment can be saved
  as a draft first. Nobody can read these answers through this function: Total Rewards reads them in the
  Senior Manager area.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PEER_PER_HOUR = 60;

const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

/* The form, if it is a switched on, open form of that category that this department may use. */
async function openForm(id, category, dept) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const cols = 'id,title,category,period,scale_max,criteria,opens_on,closes_on';
  let r = await E.rest('GET', `scorecards?id=eq.${id}&active=eq.true&category=eq.${category}&select=${cols},department`);
  if (!r.ok) r = await E.rest('GET', `scorecards?id=eq.${id}&active=eq.true&category=eq.${category}&select=${cols}`);   // before phase10.sql
  const f = list(r)[0];
  const today = E.manilaDate();
  if (!f || (f.opens_on && f.opens_on > today) || (f.closes_on && f.closes_on < today)) return null;
  if (!E.formFits(f, dept)) return null;
  return f;
}

/* Turns the typed answers into the evaluation's copy of the questions. Returns null if anything is out of range. */
function snapshot(form, answers) {
  const by = {};
  (Array.isArray(answers) ? answers : []).forEach((a) => { if (a && typeof a === 'object') by[String(a.id)] = a; });
  const out = [];
  for (const c of Array.isArray(form.criteria) ? form.criteria : []) {
    const a = by[String(c.id)] || {};
    const type = E.qType(c);
    const options = E.optionsOf(c);
    let comment = String(a.comment === undefined || a.comment === null ? '' : a.comment).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, type === 'short' ? 300 : 1000);
    let rating = null, picked = [];
    const own = Number(c.scale);
    const maxRating = type === 'stars' ? 5 : own >= 3 && own <= 10 ? own : form.scale_max;
    if (E.isScored(type)) {
      if (a.rating !== null && a.rating !== undefined && a.rating !== '') {
        rating = Number(a.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > maxRating) return null;
      }
    } else if (E.hasOptions(type)) {
      comment = '';
      const want = Array.isArray(a.picked) ? a.picked.map((x) => String(x)) : [];
      picked = options.filter((o) => want.indexOf(o) !== -1);                 // only the form's own options
      if (picked.length !== new Set(want).size) return null;
      if (type !== 'checkbox' && picked.length > 1) return null;
    } else if (type === 'date') {
      if (comment && !/^\d{4}-\d{2}-\d{2}$/.test(comment)) return null;
    } else if (type === 'time') {
      if (comment && !/^\d{2}:\d{2}$/.test(comment)) return null;
    }
    out.push({
      id: c.id, type, title: c.title, description: c.description || '', weight: E.isScored(type) ? 1 : 0,
      required: c.required === undefined ? E.isScored(type) : !!c.required, options, rating, comment, picked,
      scale: type === 'rating' ? maxRating : undefined,
      labels: type === 'rating' && Array.isArray(c.labels) ? c.labels.slice(0, 10).map((l) => String(l || '').slice(0, 40)) : undefined
    });
  }
  return out.length ? out : null;
}

function overallOf(v) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, 3000);
}

async function recent(action, who, minutes) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const r = await E.rest('GET', `audit_log?action=eq.${action}&actor_email=eq.${encodeURIComponent(who)}&at=gte.${encodeURIComponent(since)}&select=id&limit=200`);
  return list(r).length;
}

/* The active colleague with this id, if (and only if) they are in the same department as the employee. */
async function findColleague(colleagueId, me, dept) {
  if (!dept) return { error: "Your department hasn't been set yet, so peer evaluations aren't available. Please ask Staffing and Recruitment.", status: 403 };
  if (!UUID_RE.test(String(colleagueId || ''))) return { error: 'Choose a colleague from the list.', status: 400 };
  if (colleagueId === me.emp.id) return { error: "That's you. Use your own self-assessment for that.", status: 400 };
  const r = await E.rest('GET', `employees?id=eq.${colleagueId}&active=eq.true&department=eq.${dept}&select=id,employee_no,full_name`);
  const hit = list(r)[0];
  if (!hit) return { error: 'You can only evaluate colleagues in your own department.', status: 403 };
  return { emp: hit };
}

module.exports = async function handler(req, res) {
  // grievances live in _grievance.js; they share this function so the site stays within Vercel's 12-function limit
  if (req.query && req.query.gr !== undefined) return require('./_grievance')(req, res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });
  const eid = me.emp.id, no = me.emp.employee_no;
  const dept = await E.deptOf(eid);

  if (req.method === 'GET') return E.send(res, 200, await E.evaluationForms(eid));

  const body = await E.readJson(req);
  if (!body) return E.send(res, 400, { error: 'Bad request.' });
  const gone = { error: "That form isn't open any more." };

  /* ---- the employee's own self-assessment ---- */
  if (body.action === 'self') {
    const form = await openForm(body.form_id, 'self', dept);
    if (!form) return E.send(res, 404, gone);
    const criteria = snapshot(form, body.answers);
    if (!criteria) return E.send(res, 400, { error: 'Some answers are not valid.' });
    const submit = body.submit === true;
    const ex = list(await E.rest('GET', `evaluations?employee_id=eq.${eid}&scorecard_id=eq.${form.id}&category=eq.self&select=id,status`))[0];
    if (ex && ex.status === 'final') return E.send(res, 409, { error: 'You have already submitted this one.' });
    const fields = { criteria, overall_comment: overallOf(body.overall), status: submit ? 'final' : 'draft' };
    const r = ex
      ? await E.rest('PATCH', `evaluations?id=eq.${ex.id}`, fields, 'return=representation')
      : await E.rest('POST', 'evaluations', Object.assign({
        employee_id: eid, evaluator_employee_id: eid, scorecard_id: form.id, scorecard_title: form.title,
        period: form.period || 'General', scale_max: form.scale_max, category: 'self'
      }, fields), 'return=representation');
    if (!r.ok || !list(r)[0]) {
      const msg = r.data && r.data.message ? String(r.data.message) : '';
      return E.send(res, 400, { error: /required question/i.test(msg) ? 'Answer every required question before you submit.' : "Couldn't save that. Try again." });
    }
    await E.logAudit(submit ? 'eval.self.submit' : 'eval.self.save', no, { form: form.id });
    return E.send(res, 200, { ok: true, status: submit ? 'final' : 'draft' });
  }

  /* ---- the colleagues of the same department, and which ones this employee has already evaluated ---- */
  if (body.action === 'peer_list') {
    const form = await openForm(body.form_id, 'peer', dept);
    if (!form) return E.send(res, 404, gone);
    if (!dept) return E.send(res, 200, { colleagues: [], no_department: true });
    const [mates, given] = await Promise.all([
      E.rest('GET', `employees?active=eq.true&department=eq.${dept}&id=neq.${eid}&select=id,full_name,position&order=full_name&limit=2000`),
      E.rest('GET', `evaluations?evaluator_employee_id=eq.${eid}&scorecard_id=eq.${form.id}&category=eq.peer&select=employee_id&limit=2000`)
    ]);
    const done = new Set(list(given).map((x) => x.employee_id));
    return E.send(res, 200, { colleagues: list(mates).map((m) => ({ id: m.id, name: m.full_name, position: m.position || '', done: done.has(m.id) })) });
  }

  /* ---- a peer evaluation, final once sent ---- */
  if (body.action === 'peer') {
    const form = await openForm(body.form_id, 'peer', dept);
    if (!form) return E.send(res, 404, gone);
    if ((await recent('eval.peer', no, 60)) >= PEER_PER_HOUR) return E.send(res, 429, { error: 'You have sent a lot of evaluations. Wait a little and try again.' });
    const found = await findColleague(body.colleague_id, me, dept);
    if (!found.emp) return E.send(res, found.status, { error: found.error });
    const criteria = snapshot(form, body.answers);
    if (!criteria) return E.send(res, 400, { error: 'Some answers are not valid.' });
    const dup = list(await E.rest('GET', `evaluations?employee_id=eq.${found.emp.id}&evaluator_employee_id=eq.${eid}&scorecard_id=eq.${form.id}&category=eq.peer&select=id&limit=1`))[0];
    if (dup) return E.send(res, 409, { error: "You've already evaluated them with this form." });
    const r = await E.rest('POST', 'evaluations', {
      employee_id: found.emp.id, evaluator_employee_id: eid, scorecard_id: form.id, scorecard_title: form.title,
      period: form.period || 'General', scale_max: form.scale_max, category: 'peer', criteria,
      overall_comment: overallOf(body.overall), status: 'final'
    }, 'return=representation');
    if (!r.ok || !list(r)[0]) {
      const msg = r.data && r.data.message ? String(r.data.message) : '';
      return E.send(res, 400, { error: /required question/i.test(msg) ? 'Answer every required question before you send.' : "Couldn't send that. Try again." });
    }
    await E.logAudit('eval.peer', no, { form: form.id, about: found.emp.employee_no });
    return E.send(res, 200, { ok: true });
  }

  return E.send(res, 400, { error: 'Bad request.' });
};
