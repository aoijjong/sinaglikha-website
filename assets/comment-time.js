/*
  The time shown on an announcement comment: the exact time it was posted, on the Philippine clock (Asia/Manila,
  the same clock the attendance feature uses), so every phone shows the same time whatever its own setting.

    today        Today, 2:30 PM
    yesterday    Yesterday, 2:30 PM
    this year    Nov 20, 9:07 AM
    other years  Dec 31, 2025, 11:59 PM
*/
(function (root) {
  'use strict';
  var TZ = 'Asia/Manila';

  function parts(ms) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
    var o = {};
    fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    // built by hand: newer systems put a no-break space before AM/PM, which can wrap oddly
    o.time = o.hour + ':' + o.minute + ' ' + String(o.dayPeriod || '').toUpperCase();
    o.day = o.year + '-' + o.month + '-' + o.day;
    return o;
  }

  function stamp(iso, nowMs) {
    if (iso === null || iso === undefined || iso === '') return '';   // new Date(null) would read as 1 Jan 1970
    var ms = new Date(iso).getTime();
    if (isNaN(ms)) return '';
    var now = nowMs === undefined ? Date.now() : nowMs;
    var at, n, y;
    try { at = parts(ms); n = parts(now); y = parts(now - 86400000); } catch (e) { return ''; }
    if (at.day === n.day) return 'Today, ' + at.time;
    if (at.day === y.day) return 'Yesterday, ' + at.time;
    return at.month + ' ' + (at.day.split('-')[2]) + (at.year === n.year ? '' : ', ' + at.year) + ', ' + at.time;
  }

  var api = { stamp: stamp };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SngCommentTime = api;
})(typeof window !== 'undefined' ? window : this);
