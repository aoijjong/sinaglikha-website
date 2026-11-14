/*
  Employee Portal touches (portal.js is not changed except for two data attributes):
    - on desktop (1025px and wider) the greeting becomes a hero banner with an illustration
    - announcements and community posts are drawn as cards; each gets a heart with a like count (kept on the server)
    - the "Start a discussion" button reads like a post box: "What's up, Maria?"
*/
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var home = $('#v-home');
  if (!home) return;

  /* ---- the hero banner (drawn by the stylesheet on desktop only) ---- */
  var hello = $('.hello', home);
  if (hello && !hello.querySelector('.bn-art')) {
    hello.classList.add('sb-banner');
    var text = document.createElement('div');
    text.className = 'bn-text';
    while (hello.firstChild) text.appendChild(hello.firstChild);
    var lead = document.createElement('p');
    lead.className = 'bn-lead';
    lead.textContent = 'Your announcements, attendance, learning and files, all in one place.';
    text.appendChild(lead);
    var art = document.createElement('div');
    art.className = 'bn-art';
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<img class="bn-img" src="../assets/banners/employee.webp" alt="" width="233" height="220">';
    hello.appendChild(text);
    hello.appendChild(art);
  }

  /* ---- "What's up, Maria?" on the post box ---- */
  var open = $('#fc-open');
  function paintOpen() {
    var h = ($('#h-hello') || {}).textContent || '', first = h.replace(/^Hello,?\s*/, '').trim();
    var t = $('#fc-open-t');
    if (t) t.textContent = first ? 'What’s up, ' + first + '?' : 'What’s up?';
  }
  if (open && $('#h-hello')) {
    new MutationObserver(paintOpen).observe($('#h-hello'), { childList: true, characterData: true, subtree: true });
    paintOpen();
  }

  /* ---- the heart on every announcement and community post: kept on the server, so everyone sees the counts ---- */
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  var FEEDS = { '#ann-feed': ['announcement', 'aid'], '#forum-feed': ['thread', 'thread'] };
  function label(n) { return n > 0 ? n + (n === 1 ? ' like' : ' likes') : 'Like'; }
  function paint(b, on, n) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.dataset.n = String(n);
    b.lastChild.textContent = label(n);
  }
  async function api(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try { var r = await fetch(path, opts); return { ok: r.ok, data: await r.json().catch(function () { return {}; }) }; }
    catch (e) { return { ok: false, data: {} }; }
  }
  var known = {};   // ids already asked about, per kind
  async function decorate(feed, kind, attr) {
    var cards = [].filter.call(feed.querySelectorAll('article.post'), function (c) { return c.dataset[attr] && !c.querySelector('.p-like'); });
    if (!cards.length) return;
    cards.forEach(function (card) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-like';
      b.dataset.kind = kind;
      b.dataset.id = card.dataset[attr];
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = HEART + '<span>Like</span>';
      b.dataset.n = '0';
      if (kind === 'announcement') card.appendChild(b);
      else { var foot = card.querySelector('.post-foot'); if (foot) foot.insertBefore(b, foot.firstChild); }
      // announcements posted in the last three days are marked New
      if (kind === 'announcement' && !card.querySelector('.ann-new')) {
        var when = (card.querySelector('.who span') || {}).textContent || '';
        if (/just now|min ago|h ago|·\s*[1-3] d ago/.test(when)) {
          var n = document.createElement('span'); n.className = 'ann-new'; n.textContent = 'New'; card.appendChild(n);
        }
      }
    });
    // one request for the whole feed: how many hearts each post has, and which ones are mine
    var ids = cards.map(function (c) { return c.dataset[attr]; }).slice(0, 60);
    var r = await api('GET', '/api/employee-likes?kind=' + kind + '&ids=' + encodeURIComponent(ids.join(',')));
    if (!r.ok || !r.data.counts) return;
    ids.forEach(function (id) {
      var b = feed.querySelector('.p-like[data-id="' + id + '"]');
      if (b) paint(b, (r.data.mine || []).indexOf(id) !== -1, r.data.counts[id] || 0);
    });
  }
  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('.p-like');
    if (!b || b.disabled) return;
    var was = b.getAttribute('aria-pressed') === 'true', n = Number(b.dataset.n) || 0, on = !was;
    paint(b, on, Math.max(0, n + (on ? 1 : -1)));          // the heart answers at once
    b.disabled = true;
    var r = await api('POST', '/api/employee-likes', { kind: b.dataset.kind, item_id: b.dataset.id, liked: on });
    b.disabled = false;
    if (r.ok && typeof r.data.count === 'number') paint(b, on, r.data.count);
    else paint(b, was, n);                                  // it did not save: put the heart back
  });
  Object.keys(FEEDS).forEach(function (s) {
    var feed = $(s);
    if (!feed) return;
    new MutationObserver(function () { decorate(feed, FEEDS[s][0], FEEDS[s][1]); }).observe(feed, { childList: true });
    decorate(feed, FEEDS[s][0], FEEDS[s][1]);
  });
})();
