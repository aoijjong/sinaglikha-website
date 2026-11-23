/*
  Grievances for the signed-in employee (supabase/grievances.sql). Reached through /api/employee-evaluate?gr=1 so the
  site stays within Vercel's 12-function limit. Handlers (Legal Compliance) never come through here: they use the
  database functions from the Senior Manager portal.

  GET  ?gr=1                              { available, mine: [...] }  this employee's CONFIDENTIAL grievances
                                          (available is false until supabase/grievances.sql has been run)
  GET  ?gr=1&id=<uuid>                    one of your own confidential grievances, with the replies you may see
  GET  ?gr=1&ticket=GRV-2026-0001&code=ABCD-2345   an ANONYMOUS grievance, by ticket number AND access code
  POST ?gr=1 { action: "submit", category, subject, body, incident_date?, location?, involved?, anonymous? }
  POST ?gr=1 { action: "reply", id | (ticket, code), body }

  Two kinds of grievance
    confidential  stored with the employee; only Legal Compliance can reveal who (and each reveal is logged)
    anonymous     NO employee is stored. The reply gives a ticket number and a secret access code, which are the only way
                  back in. Its times are rounded to the day (so a login time cannot be matched to it), nothing about it is
                  written to the activity log, and wrong ticket/code guesses are counted per device.
  Who is asking always comes from the sign-in cookie. A ticket number alone never opens anything. Private notes written
  by Legal Compliance are never sent. Text is kept as plain text.
  Limits: 3 confidential grievances a day per employee; 30 anonymous ones a day in all (one person cannot be told apart);
  20 messages a day on one grievance.
*/

const E = require('./_employee');
const M = require('../assets/grievance-meta.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_DAY = 3;
const ANON_PER_DAY = 30;
const MESSAGES_PER_DAY = 20;
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

const CASE_COLS = 'id,ticket_no,category,subject,body,incident_date,location,involved,confidentiality,status,outcome,created_at';

function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}
/* the start of today on the Philippine clock; anonymous cases are stamped with this instead of the exact time */
const dayStart = () => new Date(E.manilaDate() + 'T00:00:00+08:00').toISOString();
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d;
}

/* What the employee may see of a case: never the access code hash, never a private note, and Legal replies are not named. */
async function caseView(g) {
  const m = list(await E.rest('GET', `grievance_messages?grievance_id=eq.${g.id}&author_kind=in.(employee,legal)&select=author_kind,body,created_at&order=id.asc&limit=300`));
  return {
    case: {
      ticket_no: g.ticket_no, category: g.category, subject: g.subject, body: g.body, incident_date: g.incident_date,
      location: g.location || '', involved: g.involved || '', confidentiality: g.confidentiality, status: g.status,
      outcome: g.outcome || '', created_at: g.created_at
    },
    messages: m.map((x) => ({ from: x.author_kind === 'employee' ? 'you' : 'legal', body: x.body, created_at: x.created_at }))
  };
}

/* One case, for the person allowed to open it: its owner (confidential) or whoever holds the ticket and code (anonymous). */
async function findCase(eid, src, ip) {
  if (src.id !== undefined && src.id !== null && src.id !== '') {
    const id = String(src.id);
    if (!UUID_RE.test(id)) return { status: 400, error: 'Bad request.' };
    const g = list(await E.rest('GET', `grievances?id=eq.${id}&employee_id=eq.${eid}&select=${CASE_COLS}`))[0];
    return g ? { g } : { status: 404, error: "That grievance isn't available." };
  }
  const ticket = M.normalizeTicket(src.ticket), code = E.normalizeCode(src.code);
  const nope = { status: 404, error: "That ticket number and access code don't match." };
  if (!M.TICKET_RE.test(ticket) || code.length !== 8) return nope;
  if (await E.deviceBlocked(ip)) return { status: 429, error: 'Too many wrong tries from this device. Try again in 15 minutes.' };
  const g = list(await E.rest('GET', `grievances?ticket_no=eq.${encodeURIComponent(ticket)}&confidentiality=eq.anonymous&select=${CASE_COLS},code_hash`))[0];
  const ok = !!g && E.sameText(E.codeHash(code), g.code_hash || '');
  if (!ok) { await E.noteAttempt(ip, null, false); return nope; }
  delete g.code_hash;
  return { g, anonymous: true };
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
  const ip = E.ipHash(req);
  const q = req.query || {};

  if (req.method === 'GET') {
    if (q.id !== undefined || q.ticket !== undefined) {
      const f = await findCase(eid, q, ip);
      if (!f.g) return E.send(res, f.status, { error: f.error });
      return E.send(res, 200, await caseView(f.g));
    }
    const r = await E.rest('GET', `grievances?employee_id=eq.${eid}&select=id,ticket_no,category,subject,status,created_at&order=created_at.desc&limit=50`);
    // Before supabase/grievances.sql has been run the table does not exist: the portal then shows nothing.
    if (!r.ok || !Array.isArray(r.data)) return E.send(res, 200, { available: false, mine: [] });
    return E.send(res, 200, { available: true, mine: r.data });
  }

  const body = await E.readJson(req);
  if (!body) return E.send(res, 400, { error: 'Bad request.' });

  if (body.action === 'submit') {
    const category = String(body.category || '');
    const subject = clean(body.subject, M.LIMITS.subject), text = clean(body.body, M.LIMITS.body);
    const date = clean(body.incident_date, 10);
    if (!M.validCategory(category)) return E.send(res, 400, { error: 'Choose what your grievance is about.' });
    if (!subject) return E.send(res, 400, { error: 'Give your grievance a short title.' });
    if (!text) return E.send(res, 400, { error: 'Describe what happened.' });
    if (date && !validDate(date)) return E.send(res, 400, { error: 'That date is not valid.' });
    if (date && date > E.manilaDate()) return E.send(res, 400, { error: 'The date cannot be in the future.' });
    const anon = body.anonymous === true;

    const row = { category, subject, body: text, location: clean(body.location, M.LIMITS.location), involved: clean(body.involved, M.LIMITS.involved) };
    if (date) row.incident_date = date;
    let code = null;
    if (anon) {
      const today = list(await E.rest('GET', `grievances?confidentiality=eq.anonymous&created_at=gte.${encodeURIComponent(dayStart())}&select=id&limit=${ANON_PER_DAY}`));
      if (today.length >= ANON_PER_DAY) return E.send(res, 429, { error: 'Too many anonymous grievances were sent today. Please try again tomorrow, or send it with your name kept confidential.' });
      code = E.makeCode();
      Object.assign(row, { confidentiality: 'anonymous', code_hash: E.codeHash(code), created_at: dayStart(), updated_at: dayStart() });
    } else {
      const since = new Date(Date.now() - 86400000).toISOString();
      const mine = list(await E.rest('GET', `grievances?employee_id=eq.${eid}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${PER_DAY}`));
      if (mine.length >= PER_DAY) return E.send(res, 429, { error: 'You have sent several grievances today. Legal Compliance will look at them; you can add to an existing one instead.' });
      Object.assign(row, { confidentiality: 'confidential', employee_id: eid });
    }
    const r = await E.rest('POST', 'grievances', row, 'return=representation');
    if (r.status === 404) return E.send(res, 503, { error: "Grievances aren't set up yet. Ask your administrator." });
    const made = list(r)[0];
    if (!made) return E.send(res, 500, { error: "Couldn't send that. Try again." });
    // The activity log gets the ticket number only, and nothing at all for an anonymous grievance.
    if (!anon) await E.logAudit('grievance.submit', made.ticket_no, { category });
    return E.send(res, 200, { ok: true, ticket_no: made.ticket_no, access_code: anon ? E.showCode(code) : null });
  }

  if (body.action === 'reply') {
    const text = clean(body.body, M.LIMITS.message);
    if (!text) return E.send(res, 400, { error: 'Write your message first.' });
    const f = await findCase(eid, body, ip);
    if (!f.g) return E.send(res, f.status, { error: f.error });
    if (f.g.status === 'closed') return E.send(res, 409, { error: 'This grievance is closed. Contact Legal Compliance if you need to reopen it.' });
    const day = list(await E.rest('GET', `grievance_messages?grievance_id=eq.${f.g.id}&author_kind=eq.employee&created_at=gte.${encodeURIComponent(dayStart())}&select=id&limit=${MESSAGES_PER_DAY}`));
    if (day.length >= MESSAGES_PER_DAY) return E.send(res, 429, { error: 'You have sent many messages today. Legal Compliance will reply.' });
    const msg = { grievance_id: f.g.id, author_kind: 'employee', body: text };
    if (f.g.confidentiality === 'anonymous') msg.created_at = dayStart();   // rounded, like the grievance itself
    const r = await E.rest('POST', 'grievance_messages', msg, 'return=minimal');
    if (!r.ok) return E.send(res, 500, { error: "Couldn't send that. Try again." });
    return E.send(res, 200, { ok: true });
  }

  return E.send(res, 400, { error: 'Bad request.' });
};
