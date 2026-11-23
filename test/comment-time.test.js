const test = require('node:test');
const assert = require('node:assert/strict');
const { stamp } = require('../assets/comment-time.js');

/* "now" is Mon 23 Nov 2026, 6:00 PM in Manila (10:00 UTC) */
const NOW = Date.UTC(2026, 10, 23, 10, 0);

test('shows the exact time, on the Philippine clock', () => {
  assert.equal(stamp('2026-11-23T06:30:00Z', NOW), 'Today, 2:30 PM');
  assert.equal(stamp('2026-11-23T09:59:00Z', NOW), 'Today, 5:59 PM');
  assert.equal(stamp('2026-11-23T04:00:00Z', NOW), 'Today, 12:00 PM');
  assert.equal(stamp('2026-11-22T16:05:00Z', NOW), 'Today, 12:05 AM', 'past midnight in Manila although still the 22nd in UTC');
});

test('yesterday, earlier this year, and other years', () => {
  assert.equal(stamp('2026-11-22T06:05:00Z', NOW), 'Yesterday, 2:05 PM');
  assert.equal(stamp('2026-11-22T15:59:00Z', NOW), 'Yesterday, 11:59 PM');
  assert.equal(stamp('2026-11-20T01:07:00Z', NOW), 'Nov 20, 9:07 AM');
  assert.equal(stamp('2025-12-31T15:59:00Z', NOW), 'Dec 31, 2025, 11:59 PM');
});

test('minutes are always two digits and no odd spaces are used', () => {
  const out = stamp('2026-11-23T01:05:00Z', NOW);
  assert.equal(out, 'Today, 9:05 AM');
  assert.ok(!/[  ]/.test(out));
});

test('bad or missing values give an empty string, never "Invalid Date"', () => {
  for (const v of ['', null, undefined, 'not a date']) assert.equal(stamp(v, NOW), '');
});

test('a clock slightly ahead of the server still reads sensibly', () => {
  assert.equal(stamp('2026-11-23T10:02:00Z', NOW), 'Today, 6:02 PM');
});
