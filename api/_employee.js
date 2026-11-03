/*
  Shared helpers for the employee sign-in functions (Employee ID + PIN, no website account).
  The file starts with an underscore, so Vercel does not publish it as a function of its own.

  How it works
    - Staffing and Recruitment adds people to the Employee Directory and issues each one a
      one-time activation code (valid 7 days, works once). Only a hash of the code is stored.
    - The employee chooses their own 6-digit PIN with that code. Only a hash of the PIN is stored,
      so nobody (the Administrator, the managers, the developers) can read a PIN.
    - Wrong tries are counted per employee (5 tries, then a 15-minute lock) and per device
      (20 wrong tries in 15 minutes). A new activation code clears a lock.
    - A signed, HttpOnly cookie keeps the employee signed in for 12 hours. Changing the PIN or
      issuing a new code signs every earlier session out.

  Environment variables (Vercel -> Project -> Settings -> Environment Variables):
    SUPABASE_URL                same as the invite function
    SUPABASE_ANON_KEY           same as the invite function
    SUPABASE_SERVICE_ROLE_KEY   same as the invite function (server only)
    EMPLOYEE_SESSION_SECRET     a long random string, at least 32 characters (server only)
*/

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const COOKIE = 'sng_emp';
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const IP_WINDOW_MINUTES = 15;
const IP_MAX_FAILS = 20;
const CODE_DAYS = 7;
const ID_RE = /^[A-Z]{3}-\d{4}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0, 1, I, L or O

const SECRET = process.env.EMPLOYEE_SESSION_SECRET || '';
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.SUPABASE_ANON_KEY || '';

function configured() {
  return !!(URL_BASE && SERVICE && SECRET.length >= 32);
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

/* Calls made with the secret key. The older service_role key is a JWT and goes in both headers;
   the newer sb_secret_ key goes only in `apikey`. */
function svc(extra) {
  return Object.assign(
    { apikey: SERVICE },
    /^sb_secret_/.test(SERVICE) ? {} : { Authorization: `Bearer ${SERVICE}` },
    extra
  );
}

async function rest(method, path, body, prefer) {
  const headers = svc({ 'Content-Type': 'application/json' });
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { ok: r.ok, status: r.status, data };
}

async function readJson(req) {
  if (!/application\/json/i.test(req.headers['content-type'] || '')) return null;
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' ? body : null;
}

/* ---------- hashing ---------- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${b64u(salt)}$${b64u(key)}`;
}

async function checkPin(pin, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const want = Buffer.from(parts[2], 'base64url');
  const got = await scrypt(String(pin), salt, want.length, { N: 16384, r: 8, p: 1 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* Spent on unknown or locked IDs so a missing account takes as long to refuse as a real one. */
let dummy = null;
async function burnTime(pin) {
  if (!dummy) dummy = await hashPin('000000');
  await checkPin(pin, dummy);
}

function hmac(label, value) {
  return crypto.createHmac('sha256', SECRET).update(label + ':' + value).digest('hex');
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function normalizeId(v) { return String(v || '').trim().toUpperCase(); }
function normalizeCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function makeCode() {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
function showCode(code) { return code.slice(0, 4) + '-' + code.slice(4); }
function codeHash(code) { return hmac('code', normalizeCode(code)); }

/* ---------- PIN rules ---------- */
const COMMON = ['123456', '654321', '112233', '121212', '123123', '123321', '159753', '147258', '258369', '789456',
  '010203', '102030', '101010', '202020', '696969', '007007', '112211', '121314'];
function pinProblem(pin, employeeNo) {
  if (!/^\d{6}$/.test(String(pin))) return 'Your PIN must be exactly 6 digits.';
  const p = String(pin);
  const digits = String(employeeNo || '').replace(/\D/g, '');
  if (/^(\d)\1{5}$/.test(p) || /^(\d\d)\1\1$/.test(p) || /^(\d\d\d)\1$/.test(p) ||
      '0123456789012'.includes(p) || '9876543210987'.includes(p) || COMMON.includes(p) ||
      (digits.length >= 4 && p.includes(digits))) {
    return 'That PIN is too easy to guess. Choose a different one.';
  }
  return '';
}

/* ---------- sessions ---------- */
function makeToken(emp, version) {
  const payload = b64u(JSON.stringify({
    sub: emp.id, no: emp.employee_no, v: version,
    exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600
  }));
  return payload + '.' + hmac('session', payload);
}
function setSession(res, emp, version) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${makeToken(emp, version)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

/* The signed-in employee for this request, or null. Checked against the database every time,
   so deactivating someone or changing their PIN ends their session at once. */
async function currentEmployee(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || !sameText(sig, hmac('session', payload))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || !data.sub || data.exp < Math.floor(Date.now() / 1000)) return null;
  const sub = encodeURIComponent(data.sub);
  const [e, s] = await Promise.all([
    rest('GET', `employees?id=eq.${sub}&select=id,employee_no,full_name,position,active,pin_set`),
    rest('GET', `employee_secrets?employee_id=eq.${sub}&select=session_version`)
  ]);
  const emp = e.ok && e.data && e.data[0];
  if (!emp || !emp.active || !emp.pin_set) return null;
  const sec = s.ok && s.data && s.data[0];
  if (!sec || sec.session_version !== data.v) return null;
  return { emp, version: sec.session_version };
}

/* ---------- guessing limits ---------- */
function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  return hmac('ip', ip);
}
async function deviceBlocked(ip) {
  const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60000).toISOString();
  const r = await rest('GET', `employee_attempts?ip_hash=eq.${ip}&ok=eq.false&at=gte.${encodeURIComponent(since)}&select=id&limit=${IP_MAX_FAILS}`);
  return !!(r.ok && Array.isArray(r.data) && r.data.length >= IP_MAX_FAILS);
}
async function noteAttempt(ip, employeeNo, ok) {
  await rest('POST', 'employee_attempts', { ip_hash: ip, employee_no: employeeNo || null, ok }, 'return=minimal');
  if (Math.random() < 0.02) {
    const old = new Date(Date.now() - 7 * 86400000).toISOString();
    await rest('DELETE', `employee_attempts?at=lt.${encodeURIComponent(old)}`, undefined, 'return=minimal');
  }
}

/* Counts a wrong PIN or code for one employee; the fifth in a row locks them for 15 minutes. */
async function noteFailure(emp, secrets) {
  const fails = (secrets.failed_attempts || 0) + 1;
  if (fails >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    await rest('PATCH', `employee_secrets?employee_id=eq.${emp.id}`, { failed_attempts: 0 }, 'return=minimal');
    await rest('PATCH', `employees?id=eq.${emp.id}`, { locked_until: until }, 'return=minimal');
  } else {
    await rest('PATCH', `employee_secrets?employee_id=eq.${emp.id}`, { failed_attempts: fails }, 'return=minimal');
  }
}
function isLocked(emp) {
  return !!(emp.locked_until && new Date(emp.locked_until).getTime() > Date.now());
}

/* ---------- the activity log (written with the secret key; nobody can edit it from the site) ---------- */
async function logAudit(action, target, detail, actor) {
  await rest('POST', 'audit_log', {
    actor: actor ? actor.id : null,
    actor_email: actor ? actor.email : target || null,
    actor_department: actor ? actor.department || null : null,
    action, target: target || null, detail: detail || null
  }, 'return=minimal');
}

async function loadEmployee(employeeNo) {
  const e = await rest('GET', `employees?employee_no=eq.${encodeURIComponent(employeeNo)}&select=id,employee_no,full_name,position,active,pin_set,code_expires_at,locked_until`);
  const emp = e.ok && e.data && e.data[0];
  if (!emp) return null;
  const s = await rest('GET', `employee_secrets?employee_id=eq.${emp.id}&select=pin_hash,code_hash,failed_attempts,session_version`);
  const sec = (s.ok && s.data && s.data[0]) || { pin_hash: null, code_hash: null, failed_attempts: 0, session_version: 1 };
  return { emp, sec };
}

/* A short-lived link to one private file, made with the secret key. Returns null if it can't be made. */
async function signUrl(bucket, filePath) {
  const path = String(filePath).split('/').map(encodeURIComponent).join('/');
  try {
    const s = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: svc({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: 300 })
    });
    const data = s.ok ? await s.json() : null;
    if (!data || !data.signedURL) return null;
    const rel = data.signedURL.startsWith('/') ? data.signedURL : '/' + data.signedURL;
    return rel.startsWith('/storage/v1/') ? `${URL_BASE}${rel}` : `${URL_BASE}/storage/v1${rel}`;
  } catch {
    return null;
  }
}

/* Today's date in the Philippines (UTC+8), as 2026-11-02. Attendance days follow this clock. */
function manilaDate(ms) {
  return new Date((ms === undefined ? Date.now() : ms) + 8 * 3600000).toISOString().slice(0, 10);
}

/* ---------- pieces of the dashboard, shared by the one-request "home" answer and the detail calls ---------- */
const list = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);

async function namesOf(ids) {
  const out = {};
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return out;
  list(await rest('GET', `employees?id=in.(${unique.join(',')})&select=id,full_name`)).forEach((e) => { out[e.id] = e.full_name; });
  return out;
}

/* Profile photos for a set of people, sent once each: { pics: [photo, ...], at(id) -> index into pics, or null }.
   table is "employees" or "profiles" (Senior Managers). A photo that isn't a small, valid image is skipped. */
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
async function photoPack(table, ids) {
  const pics = [], index = {};
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length) {
    // A missing photo column (SQL not run yet) just means nobody has a photo.
    list(await rest('GET', `${table}?id=in.(${unique.join(',')})&select=id,avatar`)).forEach((x) => {
      if (typeof x.avatar === 'string' && PHOTO_RE.test(x.avatar)) { index[x.id] = pics.length; pics.push(x.avatar); }
    });
  }
  return { pics, at: (id) => (id in index ? index[id] : null) };
}

/* This employee's own time records for the last 31 days. */
async function attendanceRecent(eid) {
  const today = manilaDate();
  const since = manilaDate(Date.now() - 31 * 86400000);
  const r = await rest('GET', `attendance_records?employee_id=eq.${eid}&work_date=gte.${since}&select=id,work_date,time_in,time_out,note&order=work_date.desc&limit=40`);
  // Before supabase/phase2.sql has been run the table doesn't exist yet.
  if (!r.ok || !Array.isArray(r.data)) return { today, records: [], unavailable: true };
  return { today, records: r.data };
}

/* Published courses with how many modules there are and how many THIS employee has completed. */
async function learningSummary(eid) {
  const c = await rest('GET', 'learning_courses?published=eq.true&select=id,title,description&order=position,created_at');
  if (!c.ok || !Array.isArray(c.data) || !c.data.length) return [];
  const ids = c.data.map((x) => x.id).join(',');
  const [m, p] = await Promise.all([
    rest('GET', `learning_modules?course_id=in.(${ids})&select=id,course_id&limit=5000`),
    rest('GET', `learning_progress?employee_id=eq.${eid}&select=module_id&limit=5000`)
  ]);
  const done = new Set(list(p).map((x) => x.module_id));
  const mods = list(m);
  return c.data.map((x) => {
    const own = mods.filter((y) => y.course_id === x.id);
    return { id: x.id, title: x.title, description: x.description || '', total: own.length, done: own.filter((y) => done.has(y.id)).length };
  });
}

/* The Self and Peer evaluation forms that are switched on and open today, for the employee's dashboard.
   Weights stay on the server. A self form also carries this employee's own answers so far; a peer form
   only says how many colleagues they have already evaluated with it, never who. */
function questionsOf(f) {
  return (Array.isArray(f.criteria) ? f.criteria : []).map((c) => ({
    id: String(c.id || ''), type: c.type === 'text' ? 'text' : 'rating', title: String(c.title || ''),
    description: String(c.description || ''), required: c.required === undefined ? c.type !== 'text' : !!c.required
  }));
}
async function evaluationForms(eid) {
  const today = manilaDate();
  const r = await rest('GET', 'scorecards?active=eq.true&category=in.(self,peer)&select=id,title,description,category,period,scale_max,labels,criteria,opens_on,closes_on&order=created_at.desc&limit=50');
  // Before supabase/phase6.sql has been run there is simply nothing to show.
  const forms = list(r).filter((f) => (!f.opens_on || f.opens_on <= today) && (!f.closes_on || f.closes_on >= today));
  if (!forms.length) return { self: [], peer: [] };
  const [mine, given] = await Promise.all([
    rest('GET', `evaluations?employee_id=eq.${eid}&category=eq.self&select=scorecard_id,status,criteria,overall_comment`),
    rest('GET', `evaluations?evaluator_employee_id=eq.${eid}&category=eq.peer&select=scorecard_id`)
  ]);
  const own = {}, done = {};
  list(mine).forEach((x) => { own[x.scorecard_id] = x; });
  list(given).forEach((x) => { done[x.scorecard_id] = (done[x.scorecard_id] || 0) + 1; });
  const shape = (f) => ({
    id: f.id, title: f.title, description: f.description || '', period: f.period || '', scale_max: f.scale_max,
    labels: Array.isArray(f.labels) ? f.labels.map((l) => String(l || '')) : [], questions: questionsOf(f),
    closes_on: f.closes_on || null
  });
  return {
    self: forms.filter((f) => f.category === 'self').map((f) => {
      const o = own[f.id];
      return Object.assign(shape(f), {
        status: o ? o.status : 'new',
        answers: o ? (o.criteria || []).map((c) => ({ id: c.id, rating: c.rating === undefined ? null : c.rating, comment: c.comment || '' })) : [],
        overall: o ? o.overall_comment || '' : ''
      });
    }),
    peer: forms.filter((f) => f.category === 'peer').map((f) => Object.assign(shape(f), { done: done[f.id] || 0 }))
  };
}

/* The open forum categories and the latest threads across them, with reply counts and author names. */
async function forumFeed(eid) {
  const c = await rest('GET', 'forum_categories?active=eq.true&select=id,name,description&order=position,created_at');
  if (!c.ok || !Array.isArray(c.data) || !c.data.length) return { categories: [], threads: [] };
  const ids = c.data.map((x) => x.id).join(',');
  const threads = list(await rest('GET', `forum_threads?category_id=in.(${ids})&hidden=eq.false&select=id,category_id,employee_id,title,body,locked,created_at,last_post_at&order=last_post_at.desc&limit=20`));
  const tids = threads.map((x) => x.id);
  const [p, who, pack] = await Promise.all([
    tids.length ? rest('GET', `forum_posts?thread_id=in.(${tids.join(',')})&hidden=eq.false&select=thread_id&limit=5000`) : { ok: true, data: [] },
    namesOf(threads.map((x) => x.employee_id)),
    photoPack('employees', threads.map((x) => x.employee_id))
  ]);
  const count = {};
  list(p).forEach((x) => { count[x.thread_id] = (count[x.thread_id] || 0) + 1; });
  return {
    categories: c.data.map((x) => ({ id: x.id, name: x.name, description: x.description || '' })),
    photos: pack.pics,
    threads: threads.map((x) => ({
      id: x.id, category_id: x.category_id, title: x.title, body: x.body, locked: x.locked, replies: count[x.id] || 0,
      author: who[x.employee_id] || 'Employee', pic: pack.at(x.employee_id), mine: x.employee_id === eid, created_at: x.created_at, last_post_at: x.last_post_at
    }))
  };
}

module.exports = {
  list, namesOf, photoPack, evaluationForms, questionsOf, attendanceRecent, learningSummary, forumFeed,
  ID_RE, CODE_DAYS, ANON, URL_BASE, signUrl, manilaDate,
  configured, send, svc, rest, readJson, hashPin, checkPin, burnTime, sameText,
  normalizeId, normalizeCode, makeCode, showCode, codeHash, pinProblem,
  setSession, clearSession, currentEmployee, ipHash, deviceBlocked, noteAttempt, noteFailure, isLocked,
  logAudit, loadEmployee
};
