/*
  Employee Portal shell. The dashboard stays one page in portal.js; this file splits it into sections and adds the navigation:
    Home    greeting, a "share" bar, Quick Access cards and the latest announcements
    Feeds   announcements and the community
    My Work attendance, evaluations, learning and compensation records
    Files   the file search and the department folders
    Profile opens the profile page
  On desktop (1025px and wider) the navigation is a sidebar on the left; on phones and tablets it is a floating bar at the bottom.
  portal.js is only asked for one thing: window.EmpPortal.show, to return to the dashboard from a sub-page.
*/
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var home = $('#v-home');
  if (!home) return;

  var SVG = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>'; };
  var ICON = {
    home: SVG('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    feeds: SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    work: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>'),
    files: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    profile: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    clip: SVG('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12l2 2 4-4"/>'),
    book: SVG('<path d="M12 6c-1.8-1.2-4.2-1.7-8-1.7V18c3.8 0 6.2.5 8 1.7 1.8-1.2 4.2-1.7 8-1.7V4.3c-3.8 0-6.2.5-8 1.7z"/><path d="M12 6v13.7"/>'),
    lock: SVG('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    send: SVG('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    heart: SVG('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>')
  };
  var NAV = [['home', 'Home'], ['feeds', 'Feeds'], ['work', 'My Work'], ['files', 'Files'], ['profile', 'Profile']];
  var HEAD = {
    feeds: ['Feeds', 'Announcements from the Senior Managers, and conversations with your colleagues.'],
    work: ['My Work', 'Your attendance, evaluations, learning and compensation records.'],
    files: ['Files', 'Search documents, or open the folders of each department.']
  };
  var QA = [
    ['att', 'Attendance', 'Time in and out', 'clock', '#att-panel', 'work', 'qa-1'],
    ['evl', 'Evaluations', 'Forms to fill in', 'clip', '#evl-panel', 'work', 'qa-2'],
    ['learn', 'Learning', 'Courses and modules', 'book', '#learn-panel', 'work', 'qa-3'],
    ['files', 'Files', 'Department folders', 'files', '#dept-panel', 'files', 'qa-4'],
    ['rec', 'My records', 'Only you see these', 'lock', '#rec-panel', 'work', 'qa-5']
  ];

  /* setting "hidden" to the value it already has still counts as a change to the observers below, so only touch it when it differs */
  function setHidden(el, v) { v = !!v; if (el && el.hidden !== v) el.hidden = v; }

  var sec = 'home';
  try { sec = sessionStorage.getItem('sng-emp-sec') || 'home'; } catch (e) { /* no storage */ }
  if (sec !== 'home' && !HEAD[sec]) sec = 'home';
  var feed = 'ann';

  document.body.classList.add('sh');
  document.body.dataset.sec = sec;
  document.body.dataset.feed = feed;

  /* ---- the navigation: a sidebar on desktop, a floating bar on phones ---- */
  var nav = document.createElement('nav');
  nav.className = 'emp-nav';
  nav.id = 'emp-nav';
  nav.setAttribute('aria-label', 'Sections');
  nav.hidden = true;
  nav.innerHTML = NAV.map(function (n) {
    return '<button type="button" data-go="' + n[0] + '"><span class="nv-ic">' + ICON[n[0]] + '</span><span class="nv-t">' + n[1] + '</span></button>';
  }).join('');
  document.body.appendChild(nav);

  /* ---- the pieces that only the Home section shows ---- */
  var hello = $('.hello', home);
  var share = document.createElement('div');
  share.className = 'hs';
  share.id = 'home-share';
  share.innerHTML = '<h2>Share something with the team</h2><button class="hs-bar" type="button" data-go="post" aria-label="Write a post in the community">' +
    '<span class="hs-t">Write here…</span><span class="hs-btn">' + ICON.send + 'Post now</span></button>';
  var quick = document.createElement('section');
  quick.className = 'qa';
  quick.id = 'home-quick';
  quick.innerHTML = '<div class="sh-h"><h2>Quick Access</h2></div><div class="qa-row">' + QA.map(function (q) {
    return '<button class="qa-c ' + q[6] + '" type="button" data-qa="' + q[0] + '"><span class="qa-ic">' + ICON[q[3]] + '</span><b>' + q[1] + '</b><small>' + q[2] + '</small></button>';
  }).join('') + '</div>';
  var recent = document.createElement('section');
  recent.className = 'rc';
  recent.id = 'home-recent';
  recent.hidden = true;
  var head = document.createElement('div');
  head.className = 'sec-head';
  head.id = 'sec-head';
  head.innerHTML = '<h1 id="sec-t"></h1><p id="sec-d"></p>' +
    '<div class="seg" id="feeds-seg" role="group" aria-label="Show"><button type="button" data-feed="ann">Announcements</button><button type="button" data-feed="forum">Community</button></div>';
  var after = hello || home.firstChild;
  after.after(share, quick, recent, head);
  var qbox = $('#q', home) && $('#q', home).closest('.sbox');
  if (qbox) qbox.id = 'q-wrap';

  /* ---- what is drawn depends on the section ---- */
  function paint() {
    document.body.dataset.sec = sec;
    document.body.dataset.feed = feed;
    var h = HEAD[sec];
    $('#sec-t').textContent = h ? h[0] : '';
    $('#sec-d').textContent = h ? h[1] : '';
    Array.prototype.forEach.call($('#feeds-seg').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.feed === feed)); });
    // quick cards for things that are switched off (no courses, no records, attendance not set up) are left out
    QA.forEach(function (q) {
      var card = $('[data-qa="' + q[0] + '"]', quick), panel = $(q[4]);
      if (card) setHidden(card, panel && panel.hidden);
    });
    var forum = $('#forum-panel');
    setHidden(share, forum && forum.hidden);
    // the sidebar or the bar marks where you are, even on a sub-page (a folder, a course, an evaluation)
    var at = !$('#v-profile').hidden ? 'profile' : !$('#v-dept').hidden ? 'files' : (!$('#v-learn').hidden || !$('#v-eval').hidden) ? 'work' : sec;
    Array.prototype.forEach.call(nav.children, function (b) {
      if (b.dataset.go === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    setHidden(nav, $('#top-right').hidden);
  }

  function remember() { try { sessionStorage.setItem('sng-emp-sec', sec); } catch (e) { /* no storage */ } }

  function go(name, then) {
    if (name === 'profile') { var pb = $('#btn-profile'); if (pb) pb.click(); return; }
    if (name === 'post') { feed = 'forum'; name = 'feeds'; then = function () { var o = $('#fc-open'); if (o && !o.hidden) o.click(); }; }
    if (name !== 'home' && !HEAD[name]) name = 'home';
    // a search left open in Files would keep the other sections hidden
    var q = $('#q');
    if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
    sec = name;
    remember();
    if (home.hidden && window.EmpPortal) window.EmpPortal.show('home');
    paint();
    window.scrollTo(0, 0);
    if (then) setTimeout(then, 60);
  }

  nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });
  home.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    var f = e.target.closest('button[data-feed]');   // not any [data-feed]: the page itself carries one
    if (f) { feed = f.dataset.feed; paint(); return; }
    var c = e.target.closest('[data-qa]');
    if (c) {
      var q = QA.filter(function (x) { return x[0] === c.dataset.qa; })[0];
      go(q[5], function () { var p = $(q[4]); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      return;
    }
    if (e.target.closest('[data-recent]')) { feed = 'ann'; go('feeds'); }
  });

  /* ---- the latest announcements, as small cards on Home ---- */
  var timer;
  function buildRecent() {
    var posts = [].slice.call(document.querySelectorAll('#ann-feed article.post')).slice(0, 3);
    if (!posts.length) { setHidden(recent, true); return; }
    recent.innerHTML = '<div class="sh-h"><h2>Recent activity</h2><button class="sh-all" type="button" data-recent="1">View all</button></div><div class="rc-list">' +
      posts.map(function (p) {
        var av = $('.av-sm', p), who = $('.who b', p), when = $('.who span', p), title = $('.post-title', p), body = $('.post-body', p), like = $('.p-like span', p);
        var n = like && /\d/.test(like.textContent) ? like.textContent.replace(/\D+/g, '') : '';
        return '<article class="rc-c" data-recent="1" tabindex="0"><div class="rc-top">' + (av ? av.outerHTML : '') + '<div class="who"><b>' + (who ? who.innerHTML : '') + '</b><span>' + (when ? when.innerHTML : '') + '</span></div></div>' +
          (title ? '<h3>' + title.innerHTML + '</h3>' : '') + '<p>' + (body ? body.innerHTML : '') + '</p>' +
          (n ? '<div class="rc-foot"><span>' + ICON.heart + n + '</span></div>' : '') + '</article>';
      }).join('') + '</div>';
    setHidden(recent, false);
  }
  var feedEl = $('#ann-feed');
  if (feedEl) {
    new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(buildRecent, 120); }).observe(feedEl, { childList: true, subtree: true, characterData: true });
    buildRecent();
  }
  recent.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.rc-c')) { e.preventDefault(); feed = 'ann'; go('feeds'); }
  });

  /* ---- keep the navigation in step with whichever page is showing ---- */
  var watch = new MutationObserver(function () {
    // opening a folder, a course or an evaluation leaves you in the section it belongs to, so Back returns there
    if (!$('#v-dept').hidden) sec = 'files';
    else if (!$('#v-learn').hidden || !$('#v-eval').hidden) sec = 'work';
    paint();
  });
  watch.observe($('#main'), { attributes: true, attributeFilter: ['hidden'], subtree: true });
  watch.observe($('#top-right'), { attributes: true, attributeFilter: ['hidden'] });
  ['#att-panel', '#learn-panel', '#evl-panel', '#rec-panel', '#forum-panel'].forEach(function (s) {
    var el = $(s);
    if (el) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
  paint();
})();
