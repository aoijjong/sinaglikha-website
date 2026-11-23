/*
  The soft colour palette for Community forum categories, shared by the employee portal (the label on each post)
  and the Senior Manager portal (the colour picker and the category list).

  A category stores only a colour NAME (supabase/forum_category_colors.sql), never a colour value, so the pages can
  only ever show one of the colours below. A category with no saved colour, or an unknown one, gets a steady colour
  worked out from its id, so older categories look varied even before anyone picks one.

  Every pair has at least 4.5:1 contrast (WCAG AA); test/forum-colors.test.js checks it.
*/
(function (root) {
  'use strict';
  var LIST = [
    { key: 'rose',     name: 'Rose',     bg: '#FCE4E4', fg: '#8E2B2B' },
    { key: 'peach',    name: 'Peach',    bg: '#FFE6D5', fg: '#8A4217' },
    { key: 'butter',   name: 'Butter',   bg: '#FFF1C2', fg: '#6B4E00' },
    { key: 'sage',     name: 'Sage',     bg: '#E1F1DF', fg: '#2D6A35' },
    { key: 'mint',     name: 'Mint',     bg: '#D6F1E8', fg: '#1B6650' },
    { key: 'sky',      name: 'Sky',      bg: '#DCEBFA', fg: '#1B4B7A' },
    { key: 'lavender', name: 'Lavender', bg: '#E8E3F8', fg: '#4B3A8C' },
    { key: 'blush',    name: 'Blush',    bg: '#FBE1EE', fg: '#8A2D5C' },
    { key: 'stone',    name: 'Stone',    bg: '#EEE9E3', fg: '#5A4538' }
  ];
  var BY = {};
  LIST.forEach(function (c) { BY[c.key] = c; });

  function valid(key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(BY, key); }
  function hash(s) {
    var h = 0;
    String(s).split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
    return h;
  }
  /* the colour name a category shows: its saved one, or a steady pick from its id */
  function keyFor(cat) {
    if (cat && valid(cat.color)) return cat.color;
    return LIST[hash(cat && cat.id ? cat.id : '') % LIST.length].key;
  }
  function cls(cat) { return 'cat-' + keyFor(cat); }
  function css() {
    return LIST.map(function (c) {
      return '.chip.cat-' + c.key + ',.lico.cat-' + c.key + '{background:' + c.bg + ';color:' + c.fg + '}' +
        '.cat-sw.cat-' + c.key + '{--sw:' + c.bg + ';--sw-ink:' + c.fg + '}';
    }).join('\n');
  }

  var api = { list: LIST, valid: valid, keyFor: keyFor, cls: cls, css: css };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SngCatColors = api;
  var st = root.document && root.document.createElement('style');
  if (st) { st.textContent = css(); root.document.head.appendChild(st); }
})(typeof window !== 'undefined' ? window : this);
