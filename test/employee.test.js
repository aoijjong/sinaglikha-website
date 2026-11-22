/* Tests for the employee sign-in helpers. Run with: npm test (Node 20+, no installs needed). */
process.env.EMPLOYEE_SESSION_SECRET = 'x'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_employee.js');

test('PIN rules reject weak PINs and accept ordinary ones', () => {
  for (const bad of ['111111', '123456', '654321', '121212', '123123', '012345', '98765', 'abcdef', '12345', '1234567'])
    assert.notEqual(E.pinProblem(bad, 'HRS-0001'), '', `${bad} should be refused`);
  assert.notEqual(E.pinProblem('000142', 'HRS-0142'), '', 'a PIN holding the employee number is refused');
  assert.equal(E.pinProblem('483920', 'HRS-0007'), '');
});

test('Employee ID format', () => {
  assert.ok(E.ID_RE.test('HRS-0001'));
  for (const bad of ['hrs-0001', 'HR-0001', 'HRS0001', 'HRS-001', "HRS-0001'; drop", ''])
    assert.ok(!E.ID_RE.test(bad), bad);
  assert.equal(E.normalizeId('  hrs-0001 '), 'HRS-0001');
});

test('activation codes: alphabet, length, formatting and hashing', () => {
  for (let i = 0; i < 200; i++) {
    const c = E.makeCode();
    assert.match(c, /^[A-HJKMNP-Z2-9]{8}$/, 'no 0, 1, I, L or O');
  }
  assert.equal(E.showCode('ABCD2345'), 'ABCD-2345');
  assert.equal(E.codeHash('abcd-2345'), E.codeHash('ABCD2345'));
  assert.notEqual(E.codeHash('ABCD2345'), E.codeHash('ABCD2346'));
});

test('PIN hashing: salted, verifiable, never stores the PIN', async () => {
  const a = await E.hashPin('483920'), b = await E.hashPin('483920');
  assert.notEqual(a, b, 'a new salt every time');
  assert.ok(!a.includes('483920'));
  assert.equal(await E.checkPin('483920', a), true);
  assert.equal(await E.checkPin('483921', a), false);
  assert.equal(await E.checkPin('483920', 'garbage'), false);
  assert.equal(await E.checkPin('483920', null), false);
});

test('sameText compares safely', () => {
  assert.equal(E.sameText('abc', 'abc'), true);
  assert.equal(E.sameText('abc', 'abd'), false);
  assert.equal(E.sameText('abc', 'abcd'), false);
});

test('lockout window', () => {
  assert.equal(E.isLocked({ locked_until: new Date(Date.now() + 60000).toISOString() }), true);
  assert.equal(E.isLocked({ locked_until: new Date(Date.now() - 60000).toISOString() }), false);
  assert.equal(E.isLocked({ locked_until: null }), false);
});

test('Manila date follows UTC+8', () => {
  assert.equal(E.manilaDate(Date.UTC(2026, 10, 2, 16, 30)), '2026-11-03');
  assert.equal(E.manilaDate(Date.UTC(2026, 10, 2, 15, 59)), '2026-11-02');
});

test('foreignOrigin blocks other sites and lets the same site and tools through', () => {
  const req = (h) => ({ headers: h });
  assert.equal(E.foreignOrigin(req({ host: 'sinaglikha.vercel.app' })), false, 'no Origin header');
  assert.equal(E.foreignOrigin(req({ host: 'sinaglikha.vercel.app', origin: 'https://sinaglikha.vercel.app' })), false);
  assert.equal(E.foreignOrigin(req({ host: 'a.com', 'x-forwarded-host': 'b.com', origin: 'https://b.com' })), false);
  assert.equal(E.foreignOrigin(req({ host: 'sinaglikha.vercel.app', origin: 'https://evil.example' })), true);
  assert.equal(E.foreignOrigin(req({ host: 'sinaglikha.vercel.app', origin: 'null' })), true);
});

test('readJson refuses a foreign origin and non-JSON bodies', async () => {
  const ok = { headers: { host: 'a.com', 'content-type': 'application/json' }, body: { x: 1 } };
  assert.deepEqual(await E.readJson(ok), { x: 1 });
  assert.equal(await E.readJson({ ...ok, headers: { ...ok.headers, origin: 'https://evil.example' } }), null);
  assert.equal(await E.readJson({ headers: { host: 'a.com', 'content-type': 'text/plain' }, body: 'x' }), null);
  assert.equal(await E.readJson({ ...ok, body: '{bad' }), null);
});

/* currentEmployee is checked against the database on every request; the database is stubbed here. */
function stubDb({ active = true, pin_set = true, version = 1 } = {}) {
  global.fetch = async (url) => {
    const u = String(url);
    const rows = u.includes('/employee_secrets') ? [{ session_version: version }]
      : [{ id: 'e1', employee_no: 'HRS-0001', full_name: 'Test', position: 'X', active, pin_set }];
    return { ok: true, status: 200, json: async () => rows };
  };
}
const withCookie = (c) => ({ headers: { cookie: c } });

test('session cookie: valid, tampered, expired, wrong version, deactivated', async () => {
  const emp = { id: 'e1', employee_no: 'HRS-0001' };
  const token = E.makeToken(emp, 1);

  stubDb();
  assert.ok(await E.currentEmployee(withCookie('sng_emp=' + token)), 'valid session');
  assert.equal(await E.currentEmployee({ headers: {} }), null, 'no cookie');

  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'e2', no: 'HRS-0002', v: 1, exp: 9999999999 })).toString('base64url');
  assert.equal(await E.currentEmployee(withCookie(`sng_emp=${forged}.${sig}`)), null, 'forged payload');
  assert.equal(await E.currentEmployee(withCookie(`sng_emp=${payload}.${sig.slice(0, -1)}0`)), null, 'bad signature');

  const realNow = Date.now;
  Date.now = () => realNow() + 13 * 3600 * 1000;
  assert.equal(await E.currentEmployee(withCookie('sng_emp=' + token)), null, 'expired after 12 hours');
  Date.now = realNow;

  stubDb({ version: 2 });
  assert.equal(await E.currentEmployee(withCookie('sng_emp=' + token)), null, 'PIN changed, old session ended');
  stubDb({ active: false });
  assert.equal(await E.currentEmployee(withCookie('sng_emp=' + token)), null, 'deactivated');
});

test('rest() answers "not ok" instead of throwing when the database is unreachable', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const r = await E.rest('GET', 'employees?select=id');
  assert.equal(r.ok, false);
  assert.equal(r.status, 504);
});
