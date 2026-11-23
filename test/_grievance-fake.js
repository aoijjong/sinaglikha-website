/* Shared by the grievance tests: a small fake of the database, Supabase Storage and the email service.
   It applies the same filters and column choices the real ones would, so a test fails if the API asks for a column it should not. */
process.env.EMPLOYEE_SESSION_SECRET = 'g'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
delete process.env.RESEND_API_KEY;
delete process.env.GRIEVANCE_MAIL_FROM;
delete process.env.CRON_SECRET;

const E = require('../api/_employee.js');
const evaluate = require('../api/employee-evaluate.js');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = new Date(E.manilaDate() + 'T00:00:00+08:00').toISOString();
const cookieFor = (id) => 'sng_emp=' + E.makeToken({ id, employee_no: 'SNG-0001' }, 1);
const FORM = { action: 'submit', category: 'pay_benefits', subject: 'Overtime not paid', body: 'I was not paid for March overtime.', incident_date: '2026-03-15', location: 'Office', involved: 'My supervisor' };

const PROFILES = [
  { id: 'p-admin', email: 'admin@x.test', role: 'admin', department: null, active: true },
  { id: 'p-legal', email: 'legal@x.test', role: 'senior_manager', department: 'legal', active: true },
  { id: 'p-legal2', email: 'legal2@x.test', role: 'senior_manager', department: 'legal', active: true },
  { id: 'p-other', email: 'rewards@x.test', role: 'senior_manager', department: 'rewards', active: true },
  { id: 'p-gone', email: 'gone@x.test', role: 'senior_manager', department: 'legal', active: false }
];

function fakeDb({ missing = false } = {}) {
  const db = {
    grievances: [], grievance_messages: [], grievance_files: [], employee_attempts: [], audit_log: [], profiles: PROFILES.map((p) => ({ ...p })),
    emails: [], calls: [], storage: { files: new Set(), signFails: false }, mailFails: false,
    digest: { admin: { unacknowledged: 0, awaiting_reply: 0, overdue: 0 }, legal: { unacknowledged: 0, awaiting_reply: 0, overdue: 0 } }
  };
  let n = 0, mid = 0;
  const filterRows = (rows, u) => {
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('neq.')) rows = rows.filter((r) => String(r[k]) !== v.slice(4));
      else if (v.startsWith('gte.')) rows = rows.filter((r) => String(r[k]) >= v.slice(4));
      else if (v.startsWith('lt.')) rows = rows.filter((r) => String(r[k]) < v.slice(3));
      else if (v.startsWith('in.(')) rows = rows.filter((r) => v.slice(4, -1).split(',').includes(String(r[k])));
    }
    return rows;
  };
  global.fetch = async (url, opt = {}) => {
    const u = new URL(String(url)), method = opt.method || 'GET';
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    db.calls.push({ method, url: String(url) });

    if (u.host === 'api.resend.com') {
      if (db.mailFails) return reply(500, { message: 'down' });
      db.emails.push({ ...JSON.parse(opt.body), auth: opt.headers && opt.headers.Authorization });
      return reply(200, { id: 'e1' });
    }
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/grievances/')) {
      if (db.storage.signFails) return reply(500, { error: 'nope' });
      return reply(200, { url: u.pathname.replace('/storage/v1', '') + '?token=tok123' });
    }
    if (u.pathname.startsWith('/storage/v1/object/info/grievances/')) {
      const p = decodeURIComponent(u.pathname.replace('/storage/v1/object/info/grievances/', ''));
      return db.storage.files.has(p) ? reply(200, { size: 1234 }) : reply(404, { error: 'not found' });
    }
    if (u.pathname.endsWith('/rpc/grievance_digest')) return reply(200, db.digest);

    const table = u.pathname.split('/rest/v1/')[1];
    if (table === 'employee_secrets') return reply(200, [{ session_version: 1 }]);
    if (table === 'employees') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); return reply(200, [{ id, employee_no: 'SNG-0001', full_name: 'Test Person', position: 'X', active: true, pin_set: true }]); }
    if (!(table in db) || ['emails', 'calls', 'storage'].includes(table)) return reply(200, []);
    if (missing && table.startsWith('grievance')) return reply(404, { code: 'PGRST205', message: 'Could not find the table' });

    if (method === 'POST') {
      const row = Object.assign({ id: 'cccccccc-cccc-4ccc-8ccc-' + String(++mid).padStart(12, '0'), created_at: new Date().toISOString(), at: new Date().toISOString() }, JSON.parse(opt.body));
      if (table === 'grievances') { row.ticket_no = 'GRV-2026-' + String(++n).padStart(4, '0'); row.status = 'submitted'; row.outcome = row.outcome || ''; row.routing = row.routing || 'legal'; }
      db[table].push(row);
      return reply(201, [row]);
    }
    if (method === 'PATCH') { filterRows(db[table], u).forEach((r) => Object.assign(r, JSON.parse(opt.body))); return reply(200, []); }
    if (method === 'DELETE') { const gone = new Set(filterRows(db[table], u)); db[table] = db[table].filter((r) => !gone.has(r)); return reply(200, []); }

    let rows = filterRows(db[table].slice(), u);
    const cols = (u.searchParams.get('select') || '*').split(',');
    if (cols[0] !== '*') rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    return reply(200, rows.slice(0, Number(u.searchParams.get('limit')) || 1000));
  };
  return db;
}

function call(method, query, body, who = ME, extra = {}) {
  return new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    evaluate({ method, query: Object.assign({ gr: '1' }, query), headers: Object.assign({ cookie: cookieFor(who), host: 'x.test', 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, extra), body }, res);
  });
}
/* the cron call: no employee cookie, just the secret */
function cron(headers = {}, method = 'GET') {
  return new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    evaluate({ method, query: { gr: 'digest' }, headers: Object.assign({ host: 'x.test' }, headers), body: null }, res);
  });
}

module.exports = { E, evaluate, ME, OTHER, DAY, FORM, cookieFor, fakeDb, call, cron };
