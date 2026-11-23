const test = require('node:test');
const assert = require('node:assert/strict');
const { forgetSession, MINE } = require('../assets/session-clear.js');

function fakeStorage(init) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => m.delete(k),
    keys: () => Array.from(m.keys())
  };
}

test('forgets the Supabase login keys and nothing else', () => {
  const local = fakeStorage({
    'sb-zelxudohzmevjamvwehi-auth-token': '{"access_token":"a"}',
    'sb-zelxudohzmevjamvwehi-auth-token-code-verifier': 'v',
    'sb-zelxudohzmevjamvwehi-auth-token-user': '{}',
    'theme': 'dark',
    'sidebar-collapsed': '1',
    'sb-notes': 'keep'
  });
  const session = fakeStorage({ 'sb-abc-auth-token': 'x', 'draft': 'keep' });
  assert.equal(forgetSession(local, session), 4);
  assert.deepEqual(local.keys().sort(), ['sb-notes', 'sidebar-collapsed', 'theme']);
  assert.deepEqual(session.keys(), ['draft']);
});

test('copes with missing or blocked storage', () => {
  assert.equal(forgetSession(null, undefined), 0);
  const blocked = { get length() { throw new Error('SecurityError'); }, key() { return null; }, removeItem() {} };
  assert.equal(forgetSession(blocked, null), 0);
  assert.ok(!MINE.test('sb-x-auth-tokenevil'));
});
