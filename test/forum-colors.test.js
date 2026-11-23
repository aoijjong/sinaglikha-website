process.env.EMPLOYEE_SESSION_SECRET = 'z'.repeat(48);
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/forum-colors.js');
const E = require('../api/_employee.js');
const forum = require('../api/employee-forum.js');

function lum(hex) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every palette colour is readable (WCAG AA, 4.5:1) and the names are unique', () => {
  assert.ok(C.list.length >= 8, 'enough colours to tell categories apart');
  assert.equal(new Set(C.list.map((c) => c.key)).size, C.list.length);
  for (const c of C.list) {
    assert.match(c.bg, /^#[0-9A-F]{6}$/i);
    assert.match(c.fg, /^#[0-9A-F]{6}$/i);
    assert.ok(contrast(c.bg, c.fg) >= 4.5, `${c.key}: ${contrast(c.bg, c.fg).toFixed(2)}`);
  }
});

test('a saved colour is used; a missing or unknown one falls back to a steady colour from the id', () => {
  assert.equal(C.keyFor({ id: 'x', color: 'sky' }), 'sky');
  const a = C.keyFor({ id: 'abc-123' });
  assert.ok(C.valid(a));
  assert.equal(C.keyFor({ id: 'abc-123', color: null }), a, 'steady');
  assert.equal(C.keyFor({ id: 'abc-123', color: 'not-a-colour' }), a, 'unknown name ignored');
  assert.equal(C.keyFor({ id: 'abc-123', color: '<script>' }), a, 'markup ignored');
  assert.equal(C.keyFor({ id: 'abc-123', color: '__proto__' }), a, 'object keys ignored');
  assert.ok(C.valid(C.keyFor(null)) && C.valid(C.keyFor(undefined)));
  assert.equal(C.cls({ id: 'x', color: 'mint' }), 'cat-mint');
});

test('different categories do not all get the same colour', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `cat-${i}-uuid`);
  assert.ok(new Set(ids.map((id) => C.keyFor({ id }))).size >= 4);
});

test('the generated stylesheet only holds palette colours', () => {
  const css = C.css();
  for (const c of C.list) assert.ok(css.includes(`.chip.cat-${c.key}`) && css.includes(c.bg) && css.includes(c.fg));
  assert.ok(!/[<>]|url\(|expression/i.test(css));
});

test('catView passes only a plain colour name to the portal', () => {
  assert.equal(E.catView({ id: '1', name: 'A', color: 'rose' }).color, 'rose');
  assert.equal(E.catView({ id: '1', name: 'A' }).color, null, 'column not added yet');
  assert.equal(E.catView({ id: '1', name: 'A', color: '"><img src=x onerror=1>' }).color, null);
  assert.equal(E.catView({ id: '1', name: 'A', color: 'ROSE' }).color, null);
  assert.equal(E.catView({ id: '1', name: 'A', description: null }).description, '');
});

test('the category list endpoint sends each category with its colour', async () => {
  const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const cats = [{ id: 'c1', name: 'General', description: 'x', color: 'sage' }, { id: 'c2', name: 'Old one', description: '' }];
  global.fetch = async (url) => {
    const u = String(url);
    const reply = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('/employee_secrets')) return reply([{ session_version: 1 }]);
    if (u.includes('/employees?id=eq.')) return reply([{ id: ME, employee_no: 'HRS-0001', full_name: 'Me', position: 'X', active: true, pin_set: true }]);
    if (u.includes('/forum_categories')) return reply(cats);
    return reply([]);
  };
  const r = await new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, data: d }); } };
    forum({ method: 'GET', query: {}, headers: { cookie: 'sng_emp=' + E.makeToken({ id: ME, employee_no: 'HRS-0001' }, 1), host: 'x.test' } }, res);
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.categories.map((c) => c.color), ['sage', null]);
});
