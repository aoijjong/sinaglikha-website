/*
  The Self and Peer evaluations an employee fills in (supabase/phase6.sql). Needs an employee sign-in.

  GET  /api/employee-evaluate                       the open Self and Peer forms (same as on the dashboard)
  POST /api/employee-evaluate { "action": "self",  "form_id", "answers": [...], "overall", "submit": true|false }
                                                    save a draft or submit the employee's OWN self-assessment
  POST /api/employee-evaluate { "action": "peer_lookup", "name": "..." }
                                                    check that a typed name is one colleague; answers with that name
  POST /api/employee-evaluate { "action": "peer", "form_id", "name": "...", "answers": [...], "overall" }
                                                    submit a peer evaluation of the colleague with that exact name

  answers = [{ "id": "<question id>", "rating": 4, "comment": "...", "picked": ["Option A"] }]
  Question types: short, paragraph, choice, checkbox, dropdown, rating (linear scale), stars, date, time.

  Who is evaluating comes from the sign-in cookie, never from the request. There is no list or search of
  colleagues: the employee types a full name, and it must match exactly one active employee. Lookups are
  limited and logged. A peer evaluation is final once sent; a self-assessment can be saved as a draft first.
  Nobody can read these answers through this function: Total Rewards reads them in the Senior Manager area.
*/

const E = require('./_employee');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUPS_PER_HOUR = 20;
const PEER_PER_HOUR = 20;

const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

/* Lower case, no accents, no punctuation, single spaces: so "Juan  dela Cruz" matches "Juan Dela Cruz". */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* The form, if it is a switched on, open form of that category. */
async function openForm(id, category) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const r = await E.rest('GET', `scorecards?id=eq.${id}&active=eq.true&category=eq.${category}&select=id,title,category,period,scale_max,criteria,opens_on,closes_on`);
  const f = list(r)[0];
  const today = E.manilaDate();
  if (!f || (f.opens_on && f.opens_on > today) || (f.closes_on && f.closes_on < today)) return null;
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
    if (E.isScored(type)) {
      if (a.rating !== null && a.rating !== undefined && a.rating !== '') {
        rating = Number(a.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > (type === 'stars' ? 5 : form.scale_max)) return null;
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
      id: c.id, type, title: c.title, description: c.description || '', weight: c.weight || 0,
      required: c.required === undefined ? E.isScored(type) : !!c.required, options, rating, comment, picked
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

/* The one active colleague whose full name is exactly what was typed. */
async function findColleague(typed, me) {
  const n = norm(typed);
  if (n.length < 3) return { error: 'Type the colleague\'s full name.', status: 400 };
  const r = await E.rest('GET', 'employees?active=eq.true&select=id,employee_no,full_name&limit=5000');
  const hits = list(r).filter((e) => norm(e.full_name) === n);
  if (!hits.length) return { error: "We couldn't find a colleague with that name. Check the spelling and type their full name.", status: 404 };
  if (hits.length > 1) return { error: 'More than one colleague has that name, so it cannot be used here. Please ask Total Rewards.', status: 409 };
  if (hits[0].id === me.emp.id) return { error: "That's you. Use your own self-assessment for that.", status: 400 };
  return { emp: hits[0] };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return E.send(res, 405, { error: 'Use GET or POST.' });
  }
  if (!E.configured()) return E.send(res, 500, { error: 'Employee sign-in is not set up on the server yet.' });
  const me = await E.currentEmployee(req);
  if (!me) return E.send(res, 401, { error: 'Please sign in.' });
  const eid = me.emp.id, no = me.emp.employee_no;

  if (req.method === 'GET') return E.send(res, 200, await E.evaluationForms(eid));

  const body = await E.readJson(req);
  if (!body) return E.send(res, 400, { error: 'Bad request.' });
  const gone = { error: "That form isn't open any more." };

  /* ---- the employee's own self-assessment ---- */
  if (body.action === 'self') {
    const form = await openForm(body.form_id, 'self');
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

  /* ---- who is being evaluated: a typed name, matched exactly ---- */
  if (body.action === 'peer_lookup') {
    if ((await recent('eval.lookup', no, 60)) >= LOOKUPS_PER_HOUR) return E.send(res, 429, { error: 'Too many tries. Wait a little and try again.' });
    const found = await findColleague(body.name, me);
    await E.logAudit('eval.lookup', no, { ok: !!found.emp });
    if (!found.emp) return E.send(res, found.status, { error: found.error });
    return E.send(res, 200, { name: found.emp.full_name });
  }

  /* ---- a peer evaluation, final once sent ---- */
  if (body.action === 'peer') {
    const form = await openForm(body.form_id, 'peer');
    if (!form) return E.send(res, 404, gone);
    if ((await recent('eval.peer', no, 60)) >= PEER_PER_HOUR) return E.send(res, 429, { error: 'You have sent a lot of evaluations. Wait a little and try again.' });
    const found = await findColleague(body.name, me);
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
