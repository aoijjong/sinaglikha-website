process.env.EMPLOYEE_SESSION_SECRET = 'w'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../api/_employee.js');
const login = require('../api/employee-login.js');

const EMP = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', employee_no: 'SNG-0001', full_name: 'Maria Santos', position: 'X', active: true, pin_set: true, locked_until: null };

/* A fake Supabase that takes 25 ms per call and records which calls overlapped. */
function fakeDb({ pinHash, blocked = false }) {
  const calls = [];
  let inflight = 0, peak = 0;
  global.fetch = async (url, opt = {}) => {
    const u = decodeURIComponent(String(url)), method = opt.method || 'GET';
    calls.push({ method, u, body: opt.body ? JSON.parse(opt.body) : null });
    inflight++; peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 25));
    inflight--;
    const reply = (data) => ({ ok: true, status: 200, json: async () => data });
    if (method !== 'GET') return reply([]);
    if (u.includes('/employee_attempts')) return reply(blocked ? Array.from({ length: 20 }, (_, i) => ({ id: i })) : []);
    if (u.includes('/employee_secrets')) return reply([{ pin_hash: pinHash, code_hash: null, failed_attempts: 0, session_version: 1 }]);
    if (u.includes('/employees?employee_no=')) return reply([EMP]);
    return reply([]);
  };
  return { calls, peak: () => peak };
}
function post(body) {
  return new Promise((resolve) => {
    const headers = {};
    const res = { setHeader(k, v) { headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d, headers }); } };
    login({ method: 'POST', headers: { host: 'x.test', 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body }, res);
  });
}

test('a correct PIN signs in, sets the cookie and still records everything', async () => {
  const db = fakeDb({ pinHash: await E.hashPin('483920') });
  const r = await post({ employee_no: 'sng-0001', pin: '483920' });
  assert.equal(r.status, 200);
  assert.match(r.headers['Set-Cookie'], /^sng_emp=.+HttpOnly; Secure; SameSite=Strict/);
  const writes = db.calls.filter((c) => c.method !== 'GET');
  assert.ok(writes.some((c) => c.method === 'PATCH' && c.u.includes('employee_secrets') && c.body.failed_attempts === 0));
  assert.ok(writes.some((c) => c.method === 'PATCH' && c.u.includes('/employees?id=') && c.body.last_login_at && c.body.locked_until === null));
  assert.ok(writes.some((c) => c.method === 'POST' && c.u.includes('employee_attempts') && c.body.ok === true));
  assert.ok(writes.some((c) => c.method === 'POST' && c.u.includes('audit_log') && c.body.action === 'employee.login'));
});

test('the independent database calls overlap instead of queueing', async () => {
  const db = fakeDb({ pinHash: await E.hashPin('483920') });
  await post({ employee_no: 'SNG-0001', pin: '483920' });
  assert.ok(db.peak() >= 4, `the four writes after a correct PIN should go out together; peak overlap was ${db.peak()}`);
});

test('a wrong PIN is still refused and counted', async () => {
  const db = fakeDb({ pinHash: await E.hashPin('483920') });
  const r = await post({ employee_no: 'SNG-0001', pin: '111112' });
  assert.equal(r.status, 401);
  assert.ok(!r.headers['Set-Cookie']);
  assert.ok(db.calls.some((c) => c.method === 'POST' && c.u.includes('employee_attempts') && c.body.ok === false));
  assert.ok(db.calls.some((c) => c.method === 'PATCH' && c.u.includes('employee_secrets') && c.body.failed_attempts === 1));
});

test('a blocked device is refused even with the right PIN', async () => {
  fakeDb({ pinHash: await E.hashPin('483920'), blocked: true });
  const r = await post({ employee_no: 'SNG-0001', pin: '483920' });
  assert.equal(r.status, 429);
  assert.ok(!r.headers['Set-Cookie']);
});

/* vercel.json: the functions run next to the Tokyo database, and only the pages (not their scripts) are no-store */
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const hit = (source, p) => new RegExp('^' + source.replace(/\(\.\*\)/g, '.*') + '$').test(p);
const headerFor = (p, key) => cfg.headers.filter((h) => hit(h.source, p)).flatMap((h) => h.headers).filter((x) => x.key === key).map((x) => x.value).pop();

test('functions run in Tokyo, beside the Supabase database (ap-northeast-1)', () => {
  assert.deepEqual(cfg.regions, ['hnd1']);
});

test('pages are never stored, but their scripts and styles can be re-checked', () => {
  for (const base of ['employees', 'members']) {
    for (const p of [`/${base}`, `/${base}/`, `/${base}/index.html`]) assert.equal(headerFor(p, 'Cache-Control'), 'no-store', p);
    for (const p of [`/${base}/portal.js`, `/${base}/shell.css`, `/${base}/members.js`]) assert.equal(headerFor(p, 'Cache-Control'), undefined, p);
    assert.equal(headerFor(`/${base}/portal.js`, 'X-Robots-Tag'), 'noindex, nofollow', 'still kept out of search');
  }
  assert.equal(headerFor('/api/employee-me', 'Cache-Control'), 'no-store');
});

test('the logo files stay small', () => {
  const kb = (f) => fs.statSync(path.join(__dirname, '..', 'assets', f)).size / 1024;
  assert.ok(kb('sinaglikha-logo-notag.png') < 40, 'logo is shown 36px tall');
  assert.ok(kb('sinaglikha-mark-256.webp') < 40);
});
